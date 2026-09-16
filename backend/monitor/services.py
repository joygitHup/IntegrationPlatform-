"""仪表盘聚合。返回字段与前端 src/app/page.tsx 对齐。"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone

from datasources.models import Datasource
from executions.models import DeadLetterMessage, JobExecution
from jobs.models import IntegrationJob

JOB_STATUS_LABELS = (
    ("running", "运行中"),
    ("stopped", "已停止"),
    ("paused", "已暂停"),
    ("error", "异常"),
)


def _iso(value):
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def collect_dashboard_stats(*, environment: str = "", workspace_id: str = "", client_id: str = "") -> dict:
    jobs_qs = IntegrationJob.objects.all()
    ds_qs = Datasource.objects.all()
    # 客户账号：所有聚合必须先收敛到本客户 QuerySet 再统计，禁止看全站
    if client_id:
        jobs_qs = jobs_qs.filter(client_id=client_id)
        ds_qs = ds_qs.filter(client_id=client_id)
    if environment:
        jobs_qs = jobs_qs.filter(environment=environment)
        ds_qs = ds_qs.filter(environment=environment)
    if workspace_id:
        jobs_qs = jobs_qs.filter(workspace_id=workspace_id)
        ds_qs = ds_qs.filter(workspace_id=workspace_id)

    job_ids = list(jobs_qs.values_list("id", flat=True))
    if client_id or environment or workspace_id:
        exec_qs = JobExecution.objects.filter(job_id__in=job_ids) if job_ids else JobExecution.objects.none()
        dlq_qs = DeadLetterMessage.objects.filter(job_id__in=job_ids) if job_ids else DeadLetterMessage.objects.none()
    else:
        exec_qs = JobExecution.objects.all()
        dlq_qs = DeadLetterMessage.objects.all()

    status_map = {row["status"]: row["c"] for row in jobs_qs.values("status").annotate(c=Count("id"))}
    total_jobs = sum(status_map.values())
    running_jobs = status_map.get("running", 0)

    now = timezone.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_exec = exec_qs.filter(created_at__gte=today)
    today_count = today_exec.count()
    today_success = today_exec.filter(status="success").count()
    pending_dlq = dlq_qs.filter(status="pending").count()

    week_start = today - timedelta(days=6)
    trend_rows = (
        exec_qs.filter(created_at__gte=week_start)
        .annotate(day=TruncDate("created_at"))
        .values("day", "status")
        .annotate(c=Count("id"))
    )
    by_day: dict = defaultdict(lambda: {"success": 0, "failed": 0, "total": 0})
    for row in trend_rows:
        day = row["day"]
        if not day:
            continue
        key = day.isoformat() if hasattr(day, "isoformat") else str(day)
        count = row["c"]
        by_day[key]["total"] += count
        if row["status"] == "success":
            by_day[key]["success"] += count
        elif row["status"] in ("failed", "partial_failed"):
            by_day[key]["failed"] += count

    trend = []
    for i in range(6, -1, -1):
        day = (today - timedelta(days=i)).date().isoformat()
        bucket = by_day.get(day) or {"success": 0, "failed": 0, "total": 0}
        trend.append({"date": day, **bucket})

    job_names = {j.id: j.name for j in jobs_qs.only("id", "name")}

    recent = []
    for exe in exec_qs.order_by("-created_at")[:8]:
        recent.append({
            "id": exe.id,
            "jobId": exe.job_id,
            "jobName": job_names.get(exe.job_id) or "",
            "status": exe.status,
            "startedAt": _iso(exe.started_at or exe.created_at),
            "durationMs": exe.duration_ms,
            "successRows": exe.success_rows,
            "failedRows": exe.failed_rows,
        })

    yesterday = now - timedelta(hours=24)
    top_slowest = []
    for exe in (
        exec_qs.filter(created_at__gte=yesterday, duration_ms__isnull=False)
        .order_by("-duration_ms")[:5]
    ):
        top_slowest.append({
            "executionId": exe.id,
            "jobId": exe.job_id,
            "jobName": job_names.get(exe.job_id) or "未知任务",
            "durationMs": exe.duration_ms,
            "status": exe.status,
            "createdAt": _iso(exe.created_at),
        })

    health = []
    for ds in ds_qs.order_by("-last_test_at", "-updated_at")[:8]:
        test = (ds.last_test_status or "").strip()
        if test in ("success", "failed"):
            health_status = test
        elif ds.status == "active":
            health_status = "unknown"
        else:
            health_status = "failed"
        health.append({
            "id": ds.id,
            "name": ds.name,
            "type": ds.type,
            "status": health_status,
            "lastTestAt": _iso(ds.last_test_at),
            "lastTestError": ds.last_test_error or "",
        })

    distribution = [
        {"name": label, "value": status_map.get(key, 0), "status": key}
        for key, label in JOB_STATUS_LABELS
    ]

    return {
        "summary": {
            "totalJobs": total_jobs,
            "runningJobs": running_jobs,
            "todayExecutionCount": today_count,
            "todaySuccessRate": round(today_success / today_count * 100) if today_count else 100,
            "pendingDlq": pending_dlq,
        },
        "trendData": trend,
        "jobStatusDistribution": distribution,
        "statusDistribution": {
            "running": status_map.get("running", 0),
            "stopped": status_map.get("stopped", 0),
            "paused": status_map.get("paused", 0),
            "error": status_map.get("error", 0),
        },
        "recentExecutions": recent,
        "datasourceHealth": health,
        "topSlowestJobs": top_slowest,
        "metrics": _metrics_snapshot(),
    }


def _metrics_snapshot() -> dict:
    from monitor.metrics import snapshot_metrics

    return snapshot_metrics()
