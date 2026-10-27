"""Cron 调度器：扫描 status=running 且 schedule_type=cron 的任务。"""
from __future__ import annotations

import logging
import threading

from django.utils import timezone

logger = logging.getLogger(__name__)
_lock = threading.Lock()
_started = False


def start_scheduler() -> None:
    global _started
    with _lock:
        if _started:
            return
        _started = True
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger
    except ImportError as e:
        # APScheduler 是硬依赖，缺失时直接抛出，由调用方捕获并记录
        raise ImportError(
            "未安装 APScheduler，Cron 调度不可用，请执行 pip install APScheduler 后重启服务"
        ) from e

    scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    scheduler.add_job(_tick, "interval", seconds=30, id="cron-scan", replace_existing=True)
    # 每月 1 号 00:10 自动生成上月账单（避开刚换月时 ClientUsageDaily 最后一天数据可能还没 bump）
    scheduler.add_job(_monthly_invoice_tick, CronTrigger(day=1, hour=0, minute=10), id="monthly-invoice", replace_existing=True)
    # 每天 23:55 落库当日 SLA 快照（JobExecution 后续可能被清理，快照长期保留）
    scheduler.add_job(_daily_sla_snapshot_tick, CronTrigger(hour=23, minute=55), id="daily-sla-snapshot", replace_existing=True)
    scheduler.start()
    logger.info("任务调度器已启动")


def _daily_sla_snapshot_tick() -> None:
    """每日 SLA 快照：平台 + 各 client 分别落库。"""
    try:
        from monitor.sla import snapshot_daily_sla

        snapshot_daily_sla()
    except Exception:
        logger.exception("SLA 日快照失败")


def _monthly_invoice_tick() -> None:
    """每月 1 号 00:10 触发账单生成。"""
    try:
        from open_api.billing import generate_monthly_invoices
        invoices = generate_monthly_invoices()
        logger.info("月度账单生成完成 count=%d", len(invoices))
    except Exception:
        logger.exception("月度账单生成失败")


def _tick() -> None:
    from executions.services import enqueue_execution, purge_expired_snapshots
    from jobs.models import IntegrationJob

    if not _acquire_lease("cron-scan", ttl_seconds=25):
        return

    # 0) 心跳探针：独立于业务任务，用于 SLA 判定平台自身存活；仅保留 7 天
    try:
        from monitor.models import SlaHeartbeat
        from monitor.sla import record_heartbeat

        record_heartbeat("scheduler")
        SlaHeartbeat.objects.filter(
            beat_at__lt=timezone.now() - timezone.timedelta(days=7)
        ).delete()
    except Exception:
        logger.debug("写入 / 清理心跳失败", exc_info=True)

    # 0.1) 补算错过的 SLA 日快照（23:55 任务在停机/重启期间未执行时）
    try:
        from monitor.sla import backfill_missing_sla_snapshots

        backfill_missing_sla_snapshots()
    except Exception:
        logger.debug("补算 SLA 快照失败", exc_info=True)

    # 1) 清理已过期的 JWT 吊销记录
    try:
        from core.jwt import purge_revoked_tokens
        purge_revoked_tokens()
    except Exception:
        logger.debug("清理过期吊销记录失败", exc_info=True)

    # 2) 清理 SSO / OAuth / Ticket 临时实体（过期即删，只保留有效会话）
    try:
        from django.utils import timezone as _tz
        from sso.models import OAuthState, OAuthAuthorizationCode, SsoSession, SsoTicket

        now = _tz.now()
        OAuthState.objects.filter(expires_at__lt=now).delete()
        OAuthAuthorizationCode.objects.filter(expires_at__lt=now).delete()
        SsoTicket.objects.filter(expires_at__lt=now).delete()
        # 超过 expires_at 的会话（自然过期）直接清；revoked 状态保留审计痕迹 30 天
        SsoSession.objects.filter(expires_at__lt=now, status="active").delete()
        SsoSession.objects.filter(
            status="revoked",
            revoked_at__lt=now - timezone.timedelta(days=30),
        ).delete()
    except Exception:
        logger.debug("清理 SSO 临时实体失败", exc_info=True)

    # 3) 清理密码重置 token
    try:
        from iam.models import PasswordResetToken

        PasswordResetToken.objects.filter(expires_at__lt=timezone.now()).delete()
    except Exception:
        logger.debug("清理密码重置 token 失败", exc_info=True)

    jobs = IntegrationJob.objects.filter(status="running", schedule_type="cron")
    # P0-2：过滤 frozen client（管理员手动冻结或试用过期），避免 scan 浪费周期
    try:
        from open_api.models import IntegrationClient

        frozen_ids = set(
            IntegrationClient.objects.filter(status="frozen").values_list("id", flat=True)
        )
        if frozen_ids:
            jobs = jobs.exclude(client_id__in=frozen_ids)
    except Exception:
        logger.debug("获取 frozen client 列表失败，跳过过滤", exc_info=True)
    for job in jobs:
        if not job.schedule_cron:
            continue
        last = job.last_execution_at
        if last and (timezone.now() - last).total_seconds() < 60:
            continue
        try:
            if not _cron_due(job.schedule_cron):
                continue
        except Exception:
            continue
        enqueue_execution(job, trigger_type="schedule")
    purge_expired_snapshots()
    _freeze_expired_trials()
    _check_stale_watermarks()


def _check_stale_watermarks() -> None:
    """增量任务水位线停滞告警。

    判定：running + cron + incremental 任务，最近 N 次执行的 end_watermark 全部相同，
    说明水位线长期没推进（可能源端挂了 / 数据模式变了 / 映射断了）。
    防刷屏：24h 内同一 job 只告警一次（存 last_stale_alert_at）。
    """
    try:
        from datetime import timedelta

        from django.utils import timezone

        from executions.models import JobExecution
        from jobs.models import IntegrationJob

        now = timezone.now()
        cooldown = timedelta(hours=24)
        # 只扫 running + cron + incremental
        stale_candidates = IntegrationJob.objects.filter(
            status="running",
            schedule_type="cron",
            sync_mode="incremental",
            watermark_field__gt="",
            watermark_value__gt="",  # 已经有水位线值（至少跑过一次）
        ).exclude(
            last_stale_alert_at__gte=now - cooldown,
        )

        for job in stale_candidates:
            execs = list(
                JobExecution.objects.filter(job_id=job.id)
                .exclude(status__in=("pending", "running"))
                .order_by("-started_at")
                .values_list("end_watermark", flat=True)[:3]
            )
            if len(execs) < 3:
                continue
            # 全部 end_watermark 相同（且非空）→ 说明连续 3 次执行水位线没动
            if not all(execs) or len(set(execs)) != 1:
                continue
            # 再确认：任务不是最近刚手动改过水位线（手动 reset 后 last_execution_at 可能重置）
            stale_value = execs[0]
            last_exec = (
                JobExecution.objects.filter(job_id=job.id)
                .order_by("-started_at")
                .first()
            )
            if not last_exec or not last_exec.started_at:
                continue
            # 连续 3 次执行的时间跨度已经超过一定阈值：不用比 cron 解析，简单粗暴看 last_exec
            # 与当前间隔 > 10 分钟——说明真的停滞了，不是刚改完的"初始窗口"
            if (now - last_exec.started_at).total_seconds() < 600:
                continue
            # 触发告警
            _send_stale_watermark_alert(job, stale_value)
            job.last_stale_alert_at = now
            job.save(update_fields=["last_stale_alert_at", "updated_at"])
    except Exception:
        logger.exception("水位线停滞检查失败")


def _send_stale_watermark_alert(job, stale_value: str) -> None:
    """水位线停滞 → 走与失败告警同一条通道（邮件 / Webhook）。"""
    try:
        from executions.alerts import notify_stale_watermark

        notify_stale_watermark(
            job,
            {
                "message": (
                    f"任务 [{job.name}] 增量水位线已连续 3 次执行未推进 "
                    f"（字段 {job.watermark_field} 当前停在 {stale_value}），"
                    f"请检查源端是否仍有数据、字段映射是否正常。"
                ),
            },
        )
        logger.info("水位线停滞告警已发送: job=%s wm=%s", job.id, stale_value)
    except Exception:
        logger.exception("水位线停滞告警发送失败: job=%s", job.id)


def _freeze_expired_trials() -> None:
    """plan=trial 且 expires_at 已过的 IntegrationClient → status='frozen'，
    并顺带停掉这些 client 下 status=running 的 cron 任务（避免调度器周期浪费在必被配额门禁的 job 上）。

    反向：plan=trial 且 expires_at 在未来的 frozen client → 恢复 active，
    其 cron 任务恢复 running。
    """
    from django.utils import timezone

    now = timezone.now()
    try:
        from open_api.models import ClientEntitlement, IntegrationClient
        from jobs.models import IntegrationJob

        expired_ent_ids = list(
            ClientEntitlement.objects.filter(
                plan="trial", expires_at__isnull=False, expires_at__lt=now
            ).values_list("client_id", flat=True)
        )
        if expired_ent_ids:
            n = IntegrationClient.objects.filter(id__in=expired_ent_ids, status="active").update(status="frozen")
            if n:
                logging.getLogger(__name__).info("已冻结 %d 个过期试用版 client", n)
            m = IntegrationJob.objects.filter(
                client_id__in=expired_ent_ids, schedule_type="cron", status="running",
            ).update(status="stopped")
            if m:
                logging.getLogger(__name__).info("过期试用 client 下已停 %d 个 cron 任务", m)

        # 反向：frozen + trial + 未过期（管理员手动延长了试用）→ 恢复
        unfrozen_ent_ids = list(
            ClientEntitlement.objects.filter(
                plan="trial", expires_at__gte=now,
            ).values_list("client_id", flat=True)
        )
        if unfrozen_ent_ids:
            n2 = IntegrationClient.objects.filter(id__in=unfrozen_ent_ids, status="frozen").update(status="active")
            if n2:
                logging.getLogger(__name__).info("已解冻 %d 个试用版 client", n2)
    except Exception:
        logger.exception("试用版冻结/解冻任务失败")


def _cron_due(expr: str) -> bool:
    from jobs.cron import cron_matches

    return cron_matches(expr)


def _acquire_lease(name: str, ttl_seconds: int = 25) -> bool:
    """多实例时只有拿到租约的进程会入队，避免 Cron 重复触发。"""
    import os
    import socket
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone

    now = timezone.now()
    owner = f"{os.getpid()}@{socket.gethostname()}"

    # 优先使用 Redis SETNX 实现分布式锁
    redis_url = getattr(settings, "REDIS_URL", "") or os.getenv("REDIS_URL", "")
    if redis_url:
        try:
            import redis

            client = redis.Redis.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2)
            lock_key = f"lease:{name}"
            # SET key value NX EX ttl：仅当 key 不存在时设置，并附加过期时间
            acquired = client.set(lock_key, owner, nx=True, ex=ttl_seconds)
            if acquired:
                return True
            # 锁仍被持有（Redis EX 会自动过期，无需手动清理）
            return False
        except Exception:
            logger.exception("Redis 租约获取失败，回退到数据库租约")

    # Redis 不可用时回退到数据库行锁
    from executions.models import SchedulerLease

    expires = now + timedelta(seconds=ttl_seconds)
    lease, created = SchedulerLease.objects.get_or_create(
        name=name,
        defaults={"owner": owner, "expires_at": expires},
    )
    if created:
        return True
    if lease.expires_at and lease.expires_at <= now:
        updated = SchedulerLease.objects.filter(name=name, expires_at=lease.expires_at).update(
            owner=owner, expires_at=expires,
        )
        return updated == 1
    return False
