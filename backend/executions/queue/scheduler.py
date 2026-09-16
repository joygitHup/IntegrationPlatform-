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
    scheduler.start()
    logger.info("任务调度器已启动")


def _tick() -> None:
    from executions.services import enqueue_execution, purge_expired_snapshots
    from jobs.models import IntegrationJob

    if not _acquire_lease("cron-scan", ttl_seconds=25):
        return

    # 清理已过期的 JWT 吊销记录
    try:
        from core.jwt import purge_revoked_tokens
        purge_revoked_tokens()
    except Exception:
        logger.debug("清理过期吊销记录失败", exc_info=True)

    jobs = IntegrationJob.objects.filter(status="running", schedule_type="cron")
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
