"""SLA / 可用性计算：平台级 + client 级。"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.db.models import Avg, Count, Q, Sum
from django.utils import timezone

from executions.models import JobExecution

logger = logging.getLogger(__name__)

# 单次执行算故障的状态
_ERROR_STATUSES = ["failed", "partial_failed"]
_MAX_OUTAGE_GAP_SECONDS = 300  # 连续两次失败间隔 ≤5 分钟算同一次故障
_HEARTBEAT_GAP_SECONDS = 120  # 心跳预期 30s 一次；超过 2 分钟无心跳算中断


def _compute_outage_intervals(executions, window_end=None) -> list[dict]:
    """从执行序列中提取"故障区间"。

    口径：一次故障 = 首次失败 → 恢复（下一条成功执行）；连续失败间隔 ≤5 分钟合并为同一次故障。
    - 单次失败也有停机时长（到下一次成功为止），不再恒为 0；
    - 故障结束时间不早于首次失败，且不超过窗口终点（window_end）；
    - impacted_jobs 按 job_id 去重统计。
    window_end 为空时取当前时间（实时 SLA 口径）；日快照传当日 24:00。
    """
    records = list(
        executions.filter(status__in=_ERROR_STATUSES + ["success"])
        .order_by("created_at")
        .values("created_at", "status", "error_message", "job_id")
    )
    if not records:
        return []

    if window_end is None:
        window_end = timezone.now()

    outages: list[dict] = []
    idx = 0
    total = len(records)
    while idx < total:
        if records[idx]["status"] not in _ERROR_STATUSES:
            idx += 1
            continue

        start_at = records[idx]["created_at"]
        last_fail = records[idx]
        impacted = {records[idx].get("job_id") or ""}
        sample_error = (records[idx].get("error_message") or "")[:200]
        idx += 1

        end_at = None
        while idx < total:
            rec = records[idx]
            if rec["status"] in _ERROR_STATUSES:
                gap = (rec["created_at"] - last_fail["created_at"]).total_seconds()
                if gap > _MAX_OUTAGE_GAP_SECONDS:
                    # 间隔超过阈值：本次故障止于上一个失败点，下一轮从这里开新故障
                    break
                last_fail = rec
                impacted.add(rec.get("job_id") or "")
                if rec.get("error_message"):
                    sample_error = rec["error_message"][:200]
                idx += 1
                continue
            # 遇到成功执行 = 恢复
            end_at = rec["created_at"]
            idx += 1
            break

        if end_at is None:
            end_at = last_fail["created_at"]
        if end_at > window_end:
            end_at = window_end
        if end_at < start_at:
            end_at = start_at

        outages.append({
            "start": start_at.isoformat(),
            "end": end_at.isoformat(),
            "duration_seconds": int((end_at - start_at).total_seconds()),
            "impacted_jobs": len([j for j in impacted if j]),
            "sample_error": sample_error,
        })
    return outages


def _job_ids_for_client(client_id: str) -> list[str]:
    """JobExecution.job_id 是普通字符串字段（无外键），client 归属要看 Job 表。"""
    from jobs.models import IntegrationJob as Job

    return list(Job.objects.filter(client_id=client_id).values_list("id", flat=True))


def record_heartbeat(source: str = "scheduler", status: str = "ok", latency_ms: int = 0, note: str = "") -> None:
    """写一条心跳探针。用于独立于业务任务的平台存活监测。"""
    from monitor.models import SlaHeartbeat

    SlaHeartbeat.objects.create(source=source, status=status, latency_ms=latency_ms, note=note[:255])


def _heartbeat_gaps(start, end=None) -> tuple[int, list[dict]]:
    """统计心跳中断（start ~ end 区间）。

    预期心跳间隔 30 秒；相邻两次心跳间隔 > _HEARTBEAT_GAP_SECONDS 视为一次中断。
    end 为空表示到当前时刻。SlaHeartbeat.beat_at 使用 auto_now_add，插入顺序与时间一致。
    """
    from monitor.models import SlaHeartbeat

    qs = SlaHeartbeat.objects.filter(beat_at__gte=start, status="ok")
    if end is not None:
        qs = qs.filter(beat_at__lt=end)
    beats = list(qs.order_by("beat_at").values("beat_at"))
    if len(beats) < 2:
        return 0, []

    gaps: list[dict] = []
    total_seconds = 0
    for prev, cur in zip(beats, beats[1:]):
        gap = (cur["beat_at"] - prev["beat_at"]).total_seconds()
        if gap > _HEARTBEAT_GAP_SECONDS:
            total_seconds += int(gap)
            gaps.append({
                "start": prev["beat_at"].isoformat(),
                "end": cur["beat_at"].isoformat(),
                "duration_seconds": int(gap),
                "kind": "heartbeat",
                "sample_error": "调度器心跳中断",
            })
    return total_seconds, gaps


def snapshot_daily_sla(day=None) -> list:
    """把某天（默认今天）的 SLA 落库到 DailySla，避免 JobExecution 清理后历史丢失。"""
    from datetime import date, datetime, time

    from monitor.models import DailySla

    if day is None:
        day = timezone.now().date()
    start = timezone.make_aware(datetime.combine(day, time.min))
    end = start + timedelta(days=1)

    qs = JobExecution.objects.filter(created_at__gte=start, created_at__lt=end)
    total = qs.count()
    failed = qs.filter(status__in=_ERROR_STATUSES).count()
    success = qs.filter(status="success").count()
    outages = _compute_outage_intervals(qs, window_end=end)
    downtime = sum(o["duration_seconds"] for o in outages)
    day_seconds = 86400
    # 平台行额外计入心跳中断（基础设施停机）
    infra_seconds, infra_gaps = _heartbeat_gaps(start, end)
    platform_downtime = downtime + infra_seconds
    achieved = (1 - platform_downtime / day_seconds) * 100

    rows = [{
        "client_id": "",
        "day": day,
        "sla_achieved": round(achieved, 3),
        "status": "operational" if achieved >= 99.9 else "degraded",
        "total_executions": total,
        "failed_executions": failed,
        "success_rate": round(success / max(total, 1) * 100, 3),
        "downtime_seconds": platform_downtime,
        "outages_count": len(outages) + len(infra_gaps),
        "heartbeat_gaps": len(infra_gaps),
        "heartbeat_downtime_seconds": infra_seconds,
    }]

    # 按 client 分别落库（JobExecution.job_id → Job.client_id）
    from jobs.models import IntegrationJob as Job

    job_to_client = dict(
        Job.objects.exclude(client_id="").values_list("id", "client_id")
    )
    client_job_ids: dict[str, list[str]] = {}
    for job_id in qs.values_list("job_id", flat=True).distinct():
        cid = job_to_client.get(job_id)
        if cid:
            client_job_ids.setdefault(cid, []).append(job_id)

    for cid, jids in client_job_ids.items():
        cqs = qs.filter(job_id__in=jids)
        ctotal = cqs.count()
        cfailed = cqs.filter(status__in=_ERROR_STATUSES).count()
        csuccess = cqs.filter(status="success").count()
        coutages = _compute_outage_intervals(cqs, window_end=end)
        cdowntime = sum(o["duration_seconds"] for o in coutages)
        cachieved = (1 - cdowntime / day_seconds) * 100
        rows.append({
            "client_id": cid,
            "day": day,
            "sla_achieved": round(cachieved, 3),
            "status": "operational" if cachieved >= 99.9 else "degraded",
            "total_executions": ctotal,
            "failed_executions": cfailed,
            "success_rate": round(csuccess / max(ctotal, 1) * 100, 3),
            "downtime_seconds": cdowntime,
            "outages_count": len(coutages),
            "heartbeat_gaps": 0,
            "heartbeat_downtime_seconds": 0,
        })

    saved = []
    for row in rows:
        obj, _created = DailySla.objects.update_or_create(
            client_id=row["client_id"], day=row["day"],
            defaults={k: v for k, v in row.items() if k not in ("client_id", "day")},
        )
        saved.append(obj)
    logger.info("SLA 日快照完成 day=%s count=%d", day, len(saved))
    return saved


def backfill_missing_sla_snapshots(lookback_days: int = 3) -> int:
    """补算错过的日快照（23:55 任务因服务停机 / 重启未执行时）。"""
    from monitor.models import DailySla

    today = timezone.now().date()
    created = 0
    for offset in range(1, lookback_days + 1):
        day = today - timedelta(days=offset)
        if DailySla.objects.filter(client_id="", day=day).exists():
            continue
        try:
            snapshot_daily_sla(day)
            created += 1
        except Exception:
            logger.exception("补算 SLA 快照失败 day=%s", day)
    return created


def sla_history(days: int = 30, client_id: str | None = None) -> list[dict]:
    """读取 DailySla 历史（避免长窗口实时扫 JobExecution）。"""
    from monitor.models import DailySla

    cutoff = timezone.now().date() - timedelta(days=days)
    qs = DailySla.objects.filter(day__gte=cutoff, client_id=(client_id or ""))
    return [
        {
            "day": row.day.isoformat(),
            "slaAchieved": float(row.sla_achieved),
            "status": row.status,
            "totalExecutions": row.total_executions,
            "failedExecutions": row.failed_executions,
            "successRate": float(row.success_rate),
            "downtimeSeconds": row.downtime_seconds,
            "outagesCount": row.outages_count,
            "heartbeatGaps": row.heartbeat_gaps,
            "heartbeatDowntimeSeconds": row.heartbeat_downtime_seconds,
        }
        for row in qs.order_by("day")
    ]


_HEARTBEAT_RETENTION_DAYS = 7  # 与调度器心跳明细清理周期保持一致


def _historical_infra_downtime(start_day, end_day) -> tuple[int, int]:
    """从 DailySla 平台快照汇总心跳停机（覆盖明细已被清理的历史窗口）。

    返回 (中断秒数, 中断次数)。
    """
    from monitor.models import DailySla

    agg = DailySla.objects.filter(
        client_id="", day__gte=start_day, day__lt=end_day
    ).aggregate(seconds=Sum("heartbeat_downtime_seconds"), gaps=Sum("heartbeat_gaps"))
    return int(agg["seconds"] or 0), int(agg["gaps"] or 0)


def compute_sla(days: int = 30, client_id: str | None = None) -> dict:
    """计算 SLA。

    days: 回溯窗口（天）
    client_id: None=平台整体；指定=该 client 专属 SLA
    """
    now = timezone.now()
    cutoff = now - timedelta(days=days)

    qs = JobExecution.objects.filter(created_at__gte=cutoff)
    if client_id:
        qs = qs.filter(job_id__in=_job_ids_for_client(client_id))

    total = qs.count()
    success = qs.filter(status="success").count()
    failed = qs.filter(status__in=_ERROR_STATUSES).count()
    running = qs.filter(status="running").count()
    avg_duration = qs.aggregate(avg=Avg("duration_ms"))["avg"] or 0

    total_seconds = (now - cutoff).total_seconds()
    outages = _compute_outage_intervals(qs, window_end=now)
    # 基础设施心跳中断也算平台不可用（仅平台级口径；client 级不掺入）
    infra_gap_count = 0
    if client_id:
        infra_downtime, infra_gaps = 0, []
    else:
        # 近 7 天用心跳明细；更早的窗口用 DailySla 快照补齐（心跳明细只保留 7 天）
        live_start = max(cutoff, now - timedelta(days=_HEARTBEAT_RETENTION_DAYS))
        infra_downtime, infra_gaps = _heartbeat_gaps(live_start, now)
        hist_seconds, hist_gaps = _historical_infra_downtime(cutoff.date(), live_start.date())
        infra_downtime += hist_seconds
        infra_gap_count = len(infra_gaps) + hist_gaps
    total_downtime = sum(o["duration_seconds"] for o in outages) + infra_downtime
    max_downtime = total_seconds * 0.001

    sla_achieved = (1 - total_downtime / total_seconds) * 100 if total_seconds > 0 else 100

    return {
        "period": {
            "start": cutoff.isoformat(),
            "end": now.isoformat(),
            "days": days,
        },
        "scope": "client" if client_id else "platform",
        "clientId": client_id or "",
        "executions": {
            "total": total,
            "success": success,
            "failed": failed,
            "running": running,
            "successRate": round(success / max(total, 1) * 100, 3),
            "avgDurationMs": round(avg_duration, 0),
            "perDay": round(total / max(days, 1), 1),
        },
        "sla": {
            "target": 99.9,
            "achieved": round(sla_achieved, 3),
            "status": "operational" if sla_achieved >= 99.9 else "degraded",
            "budgetSeconds": int(max_downtime),
            "downtimeSeconds": int(total_downtime),
        },
        "infrastructure": {
            "heartbeatGaps": infra_gap_count,
            "heartbeatDowntimeSeconds": int(infra_downtime),
            "gaps": infra_gaps[:10],
        },
        "outages": sorted(outages + infra_gaps, key=lambda o: o["start"], reverse=True)[:10],
        "uptime30d": round(sla_achieved, 3),
        # 历史日快照（有 DailySla 时返回，供趋势图用）
        "history": sla_history(days, client_id),
        "updatedAt": now.isoformat(),
    }
