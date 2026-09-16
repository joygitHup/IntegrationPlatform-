"""事件调度：任务成功后按事件名唤醒 status=running 且 schedule_type=event 的任务。"""
from __future__ import annotations

import logging

from django.utils import timezone

logger = logging.getLogger(__name__)


def event_names_for(job, *, status: str) -> list[str]:
    kind = "failed" if status in ("failed", "error") else "completed"
    names = [f"job.{kind}", f"job.{kind}.{job.code}", f"job.{kind}.{job.id}"]
    extra = (getattr(job, "schedule_cron", "") or "").strip()
    if extra and extra not in names:
        names.append(extra)
    return names


def matches_event(listener, names: set[str]) -> bool:
    wanted = (getattr(listener, "schedule_cron", "") or "").strip() or "job.completed"
    if wanted in ("*", "job.*"):
        return True
    return wanted in names


def emit_job_event(job, *, status: str, triggered_by: str = "") -> int:
    """返回入队的监听任务数。不会把刚跑完的自己再入队。"""
    from executions.services import enqueue_execution
    from jobs.models import IntegrationJob

    names = set(event_names_for(job, status=status))
    listeners = IntegrationJob.objects.filter(status="running", schedule_type="event").exclude(id=job.id)
    queued = 0
    now = timezone.now()
    for listener in listeners:
        if not matches_event(listener, names):
            continue
        last = listener.last_execution_at
        if last and (now - last).total_seconds() < 30:
            continue
        try:
            enqueue_execution(
                listener,
                trigger_type="event",
                triggered_by=triggered_by or job.code or job.id,
            )
            listener.last_execution_at = now
            listener.save(update_fields=["last_execution_at", "updated_at"])
            queued += 1
        except Exception:
            logger.exception("事件触发失败 listener=%s event=%s", listener.code, names)
    return queued
