"""执行记录与死信队列服务。"""
from __future__ import annotations

import logging

from django.db.models import Count, Q
from django.utils import timezone

logger = logging.getLogger(__name__)

from core.exceptions import ApiError
from executions.models import DeadLetterMessage, JobExecution
from executions.pipeline import desensitize_record, fingerprint, jsonable, resolve_sensitive_fields
from jobs.models import IntegrationJob


def _iso(value):
    return value.isoformat() if value else None


def serialize_execution(exe: JobExecution, job: IntegrationJob | None = None) -> dict:
    """对外字段与前端 executions/page.tsx 对齐。"""
    if job is None:
        job = IntegrationJob.objects.filter(id=exe.job_id).first()
    duration = exe.duration_ms
    return {
        "id": exe.id,
        "jobId": exe.job_id,
        "jobName": job.name if job else "",
        "jobCode": job.code if job else "",
        "triggerType": exe.trigger_type,
        "triggeredBy": exe.triggered_by,
        "status": exe.status,
        "startedAt": _iso(exe.started_at),
        "endedAt": _iso(exe.finished_at),
        "finishedAt": _iso(exe.finished_at),
        "duration": duration,
        "durationMs": duration,
        "processedRows": exe.total_rows,
        "totalRows": exe.total_rows,
        "successRows": exe.success_rows,
        "failedRows": exe.failed_rows,
        "skippedRows": exe.skipped_rows,
        "watermarkValue": exe.end_watermark,
        "startWatermark": exe.start_watermark,
        "endWatermark": exe.end_watermark,
        "watermarkField": job.watermark_field if job else "",
        "syncMode": job.sync_mode if job else "",
        "errorMessage": exe.error_message,
        "errorStack": exe.error_stack,
        "retryCount": exe.retry_attempts,
        "maxRetries": job.retry_count if job else 0,
        "queueJobId": exe.queue_job_id,
        "workflowRunId": exe.workflow_run_id,
        "stepId": exe.step_id,
        "createdAt": _iso(exe.created_at),
    }


def serialize_dead_letter(dl: DeadLetterMessage, job: IntegrationJob | None = None) -> dict:
    if job is None:
        job = IntegrationJob.objects.filter(id=dl.job_id).first()
    status = "resolved" if dl.status == "reprocessed" else dl.status
    note = ""
    if dl.processed_at:
        action = {
            "ignored": "已忽略",
            "resolved": "已解决",
            "reprocessed": "已解决",
            "reprocessing": "重处理中",
        }.get(status, status)
        note = f"{action}（{dl.processed_by or '-'}）"
    return {
        "id": dl.id,
        "jobId": dl.job_id,
        "jobName": job.name if job else "",
        "executionId": dl.execution_id,
        "payload": dl.payload if isinstance(dl.payload, (dict, list)) else {},
        "isDesensitized": dl.is_desensitized,
        "errorMessage": dl.error_message,
        "errorType": dl.error_type,
        "retryCount": dl.retry_count,
        "status": status,
        "processedAt": _iso(dl.processed_at),
        "processedBy": dl.processed_by,
        "resultNote": note,
        "createdAt": _iso(dl.created_at),
    }


def jobs_map(ids) -> dict[str, IntegrationJob]:
    id_set = {i for i in ids if i}
    if not id_set:
        return {}
    return {j.id: j for j in IntegrationJob.objects.filter(id__in=id_set)}


def list_executions(**filters):
    qs = JobExecution.objects.all().order_by("-created_at")
    if filters.get("job_id"):
        qs = qs.filter(job_id=filters["job_id"])
    if filters.get("status"):
        qs = qs.filter(status=filters["status"])
    if filters.get("trigger_type"):
        qs = qs.filter(trigger_type=filters["trigger_type"])
    keyword = filters.get("keyword")
    if keyword:
        job_ids = list(
            IntegrationJob.objects.filter(
                Q(name__icontains=keyword) | Q(code__icontains=keyword)
            ).values_list("id", flat=True)
        )
        qs = qs.filter(Q(id__icontains=keyword) | Q(error_message__icontains=keyword) | Q(job_id__in=job_ids))
    if filters.get("created_by"):
        from open_api.tenancy import partner_q

        owned = IntegrationJob.objects.filter(partner_q(filters["created_by"])).values_list("id", flat=True)
        qs = qs.filter(job_id__in=owned)
    if filters.get("client_id"):
        # 严格按资源归属客户过滤（不再放宽 created_by）
        qs = qs.filter(job__client_id=filters["client_id"])
    if filters.get("workspace_id"):
        from open_api.tenancy import workspace_job_ids

        qs = qs.filter(job_id__in=workspace_job_ids(filters["workspace_id"], partner=bool(filters.get("partner_id"))))
    return qs


def execution_summary(qs=None) -> dict:
    qs = qs if qs is not None else JobExecution.objects.all()
    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today = qs.filter(created_at__gte=today_start)
    counts = {row["status"]: row["n"] for row in qs.values("status").annotate(n=Count("id"))}
    return {
        "total": qs.count(),
        "todayTotal": today.count(),
        "todaySuccess": today.filter(status="success").count(),
        "todayFailed": today.filter(status__in=["failed", "partial_failed"]).count(),
        "success": counts.get("success", 0),
        "failed": counts.get("failed", 0) + counts.get("partial_failed", 0),
        "running": counts.get("running", 0),
        "pending": counts.get("pending", 0),
    }


def list_dead_letters(**filters):
    qs = DeadLetterMessage.objects.all().order_by("-created_at")
    if filters.get("job_id"):
        qs = qs.filter(job_id=filters["job_id"])
    if filters.get("execution_id"):
        qs = qs.filter(execution_id=filters["execution_id"])
    status = filters.get("status")
    if status:
        if status == "resolved":
            qs = qs.filter(status__in=["resolved", "reprocessed"])
        else:
            qs = qs.filter(status=status)
    if filters.get("error_type"):
        qs = qs.filter(error_type=filters["error_type"])
    if filters.get("client_id"):
        qs = qs.filter(job__client_id=filters["client_id"])
    if filters.get("workspace_id"):
        from open_api.tenancy import workspace_job_ids

        qs = qs.filter(job_id__in=workspace_job_ids(filters["workspace_id"], partner=bool(filters.get("partner_id"))))
    keyword = filters.get("keyword")
    if keyword:
        qs = qs.filter(
            Q(id__icontains=keyword)
            | Q(execution_id__icontains=keyword)
            | Q(error_message__icontains=keyword)
        )
    return qs


def dead_letter_summary(qs=None) -> dict:
    qs = qs if qs is not None else DeadLetterMessage.objects.all()
    counts = {row["status"]: row["n"] for row in qs.values("status").annotate(n=Count("id"))}
    return {
        "pending": counts.get("pending", 0),
        "reprocessing": counts.get("reprocessing", 0),
        "ignored": counts.get("ignored", 0),
        "resolved": counts.get("resolved", 0) + counts.get("reprocessed", 0),
    }


def enqueue_execution(job, *, trigger_type: str, triggered_by: str = "", payload=None) -> dict:
    # 手动触发前做软配额预检：仅打 warning 日志（ETL 运行时会硬拦）
    if trigger_type in ("manual", "retry"):
        try:
            from open_api.entitlements import gate_rows

            owner_cid = getattr(job, "client_id", "") or getattr(job, "created_by", "") or ""
            if owner_cid and gate_rows(owner_cid, 1, raise_on_deny=False) is False:
                logger.warning(
                    "任务手动触发前预检发现月行数已超限，执行到 ETL 主循环时将拦截。"
                    " job=%s client_id=%s trigger_type=%s",
                    job.code, owner_cid, trigger_type,
                )
        except Exception:
            # 预检本身不该影响入队主流程
            pass

    from executions.dag import has_dag, start_workflow

    if has_dag(job) and not getattr(job, "_skip_dag", False):
        return start_workflow(job, trigger_type=trigger_type, triggered_by=triggered_by, payload=payload)
    execution_id = create_execution(job_id=job.id, trigger_type=trigger_type, triggered_by=triggered_by)
    item = {
        "jobId": job.id,
        "executionId": execution_id,
        "triggerType": trigger_type,
        "triggeredBy": triggered_by,
    }
    if payload is not None:
        item["payload"] = payload
    from executions.queue import get_queue

    queue_job_id = get_queue().add(item)
    return {"executionId": execution_id, "queueJobId": queue_job_id, "status": "queued"}


def purge_expired_snapshots() -> int:
    from executions.models import DataVersionSnapshot

    deleted, _ = DataVersionSnapshot.objects.filter(
        expires_at__isnull=False,
        expires_at__lte=timezone.now(),
    ).delete()
    return deleted


def schedule_retry(job, job_data: dict) -> dict | None:
    """按任务 retry_count / retry_interval 再入队一次。超过次数返回 None。"""
    try:
        max_retries = int(getattr(job, "retry_count", 0) or 0)
        attempt = int(job_data.get("retryAttempt") or 0)
        interval = int(getattr(job, "retry_interval", 0) or 0)
    except (TypeError, ValueError):
        return None
    if max_retries <= 0 or attempt >= max_retries:
        return None
    nxt = attempt + 1
    execution_id = create_execution(
        job_id=job.id,
        trigger_type="retry",
        triggered_by=str(job_data.get("executionId") or job.code or ""),
    )
    JobExecution.objects.filter(id=execution_id).update(retry_attempts=nxt)
    item = {
        "jobId": job.id,
        "executionId": execution_id,
        "triggerType": "retry",
        "triggeredBy": job_data.get("executionId") or "",
        "retryAttempt": nxt,
    }
    if job_data.get("payload") is not None:
        item["payload"] = job_data["payload"]
    for key in ("workflowRunId", "stepId", "step", "delegateJobId", "deadLetterId"):
        if job_data.get(key) is not None:
            item[key] = job_data[key]
    from executions.queue import get_queue

    queue_job_id = get_queue().add(item, delay_seconds=max(0, interval))
    JobExecution.objects.filter(id=execution_id).update(queue_job_id=queue_job_id)
    return {"executionId": execution_id, "queueJobId": queue_job_id, "retryAttempt": nxt, "delaySeconds": max(0, interval)}


def create_execution(*, job_id: str, trigger_type: str, triggered_by: str = "", queue_job_id: str = "") -> str:
    exe = JobExecution.objects.create(
        job_id=job_id,
        trigger_type=trigger_type,
        triggered_by=triggered_by or "",
        status="pending",
        queue_job_id=queue_job_id or "",
    )
    return exe.id


def update_execution(execution_id: str, **updates) -> None:
    JobExecution.objects.filter(id=execution_id).update(**updates)


def add_dead_letter(
    *,
    job_id: str,
    execution_id: str,
    payload: dict,
    error_message: str,
    error_type: str = "transform",
    sensitive_fields: list | None = None,
    desensitize_mode: str = "mask",
) -> DeadLetterMessage:
    payload = jsonable(payload) if isinstance(payload, dict) else {}
    fields = resolve_sensitive_fields(payload, sensitive_fields)
    masked = jsonable(desensitize_record(payload, fields, desensitize_mode))
    return DeadLetterMessage.objects.create(
        job_id=job_id,
        execution_id=execution_id,
        payload=masked,
        is_desensitized=bool(fields),
        payload_hash=fingerprint(payload),
        error_message=(error_message or "")[:2000],
        error_type=error_type,
        status="pending",
    )


def reprocess_dead_letter(dlq_id: str, processed_by: str) -> None:
    dl = DeadLetterMessage.objects.filter(id=dlq_id).first()
    if not dl:
        raise ApiError("死信消息不存在", 404)
    if dl.status not in ("pending", "ignored"):
        raise ApiError("当前状态不可重处理", 400)
    from executions.queue import get_queue

    execution_id = create_execution(job_id=dl.job_id, trigger_type="retry", triggered_by=processed_by)
    get_queue().add({
        "jobId": dl.job_id,
        "executionId": execution_id,
        "triggerType": "retry",
        "triggeredBy": processed_by,
        "deadLetterId": dl.id,
        "payload": dl.payload,
    })
    dl.status = "reprocessing"
    dl.processed_at = timezone.now()
    dl.processed_by = processed_by
    dl.retry_count = (dl.retry_count or 0) + 1
    dl.save()


def _job_io(job, which: str) -> dict:
    raw = getattr(job, f"{which}_config") or {}
    return dict(raw) if isinstance(raw, dict) else {}


def peek_dead_letter_target(dl: DeadLetterMessage) -> dict | None:
    job = IntegrationJob.objects.filter(id=dl.job_id).first()
    if not job or not job.target_datasource_id:
        return None
    from datasources.models import Datasource
    from datasources.services import decrypt_config
    from datasources.connectors.runtime import lookup_existing

    target = Datasource.objects.filter(id=job.target_datasource_id).first()
    if not target:
        return None
    match_keys = list(job.match_keys or [])
    row = dl.payload if isinstance(dl.payload, dict) else {}
    if not match_keys or not row:
        return None
    cfg = decrypt_config(target.type, target.config if isinstance(target.config, dict) else {})
    return lookup_existing(target.type, cfg, _job_io(job, "target"), row, match_keys)


def resolve_dead_letter(
    dlq_id: str,
    *,
    processed_by: str,
    payload: dict | None = None,
    winner: str = "source",
    execute: bool = True,
) -> dict:
    dl = DeadLetterMessage.objects.filter(id=dlq_id).first()
    if not dl:
        raise ApiError("死信消息不存在", 404)
    if dl.status not in ("pending", "ignored"):
        raise ApiError("当前状态不可裁决", 400)
    job = IntegrationJob.objects.filter(id=dl.job_id).first()
    if not job:
        raise ApiError("所属任务不存在", 404)
    incoming = payload if isinstance(payload, dict) else (dl.payload if isinstance(dl.payload, dict) else {})
    existing = peek_dead_letter_target(dl)
    if winner == "target":
        row = dict(existing or incoming)
    else:
        row = dict(incoming)
    if not row:
        raise ApiError("没有可写入的记录", 400)
    # 不管 execute 与否，都做掩码剥离检查（预览时也要告诉客户哪些字段仍带 ***）
    masked_fields = resolve_sensitive_fields({**(existing or {}), **row}, job.sensitive_fields)
    dropped = [
        f for f in masked_fields
        if isinstance(row.get(f), str) and "***" in row[f]
    ]
    if not execute:
        # 预览模式：剥离掩码字段但不真落库，返回预览结果
        clean_row = {k: v for k, v in row.items() if k not in dropped}
        return {
            "payload": clean_row if dropped else row,
            "target": existing,
            "winner": winner,
            "droppedMaskedFields": dropped,
            "wouldDrop": bool(dropped),
        }
    from datasources.models import Datasource
    from datasources.services import decrypt_config
    from datasources.connectors.runtime import load_record

    target = Datasource.objects.filter(id=job.target_datasource_id).first()
    if not target:
        raise ApiError("目标数据源不存在", 400)
    cfg = decrypt_config(target.type, target.config if isinstance(target.config, dict) else {})
    match_keys = list(job.match_keys or [])
    owner_cid = getattr(job, "client_id", "") or ""
    if owner_cid:
        # 人工裁决改字段再落库同样受行数门禁（SaaS 超限 429；私有化告警放行）
        from open_api.entitlements import gate_rows

        gate_rows(owner_cid, 1)
    operation = "update" if existing is not None else "create"
    # 掩码字段已提前算好（preview/execute 共用），execute=True 时直接剥离
    if dropped:
        row = {k: v for k, v in row.items() if k not in dropped}
        logger.info("死信裁决剥离掩码字段 %s（任务 %s），保留目标端原值", dropped, job.id)
    if not row:
        raise ApiError("裁决后的记录只包含掩码字段，请在编辑时填入真实值", 400)
    load_record(target.type, cfg, _job_io(job, "target"), row, operation=operation, match_keys=match_keys)
    dl.status = "resolved"
    dl.processed_at = timezone.now()
    dl.processed_by = processed_by
    dl.save(update_fields=["status", "processed_at", "processed_by"])
    if owner_cid:
        from open_api.usage import bump

        bump(owner_cid, rows_written=1)
    return {"written": True, "operation": operation, "winner": winner, "payload": row, "droppedMaskedFields": dropped}


def ignore_dead_letter(dlq_id: str, processed_by: str) -> None:
    dl = DeadLetterMessage.objects.filter(id=dlq_id).first()
    if not dl:
        raise ApiError("死信消息不存在", 404)
    dl.status = "ignored"
    dl.processed_at = timezone.now()
    dl.processed_by = processed_by
    dl.save()


def bulk_resolve_dead_letters(
    *,
    ids: list[str],
    action: str,
    processed_by: str,
    payloads: dict | None = None,
    default_payload: dict | None = None,
    winner: str = "source",
    execute: bool = True,
) -> list[dict]:
    """批量裁决死信（reprocess / ignore / resolve）。

    payloads: { dlq_id: payload_dict } 映射，用于 resolve 时逐条不同字段；
    default_payload: 当 payloads 没命中某 id 时回退用的公共 payload。
    不执行 ETL（execute=False）时跳过掩码剥离和落库，只返回 preview 结果。
    """
    results: list[dict] = []
    for item_id in ids:
        try:
            extra: dict = {}
            if action == "reprocess":
                reprocess_dead_letter(item_id, processed_by)
            elif action == "ignore":
                ignore_dead_letter(item_id, processed_by)
            elif action == "resolve":
                payload = (payloads or {}).get(item_id) or default_payload
                extra = resolve_dead_letter(
                    item_id,
                    processed_by=processed_by,
                    payload=payload if isinstance(payload, dict) else None,
                    winner=winner,
                    execute=execute,
                )
            results.append({"id": item_id, "success": True, **extra})
        except Exception as exc:
            logger.warning("批量裁决死信失败 id=%s action=%s err=%s", item_id, action, exc)
            results.append({"id": item_id, "success": False, "error": str(exc)})
    return results


def bulk_select_dead_letters(
    *,
    job_id: str | None = None,
    status: str | None = None,
    error_type: str | None = None,
    workspace_id: str | None = None,
    client_id: str | None = None,
) -> list[str]:
    """按筛选条件选一批死信 id，配合 bulk_resolve_dead_letters 使用。

    workspace_id/client_id 任一给了就严格按任务归属过滤，防止跨客误选。
    """
    qs = DeadLetterMessage.objects.all().order_by("-created_at")
    if job_id:
        qs = qs.filter(job_id=job_id)
    if status:
        qs = qs.filter(status=status)
    if error_type:
        qs = qs.filter(error_type=error_type)
    if workspace_id:
        from open_api.tenancy import workspace_job_ids

        job_ids = workspace_job_ids(workspace_id)
        if job_ids:
            qs = qs.filter(job_id__in=job_ids)
        else:
            return []  # workspace 无 job → 安全返回空
    if client_id:
        qs = qs.filter(job__client_id=client_id)
    return list(qs.values_list("id", flat=True))


def finish_dead_letter_retry(dlq_id: str, *, success: bool) -> None:
    dl = DeadLetterMessage.objects.filter(id=dlq_id).first()
    if not dl:
        return
    dl.status = "resolved" if success else "pending"
    dl.processed_at = timezone.now()
    dl.save(update_fields=["status", "processed_at"])


def execute_snapshot_rollback(job: IntegrationJob, snapshot, *, triggered_by: str = "") -> dict:
    """把快照数据写回目标数据源。"""
    from datasources.connectors.runtime import load_record, lookup_existing
    from datasources.models import Datasource
    from datasources.services import decrypt_config
    from executions.etl import _io_cfg
    from executions.models import DataVersionSnapshot

    if not isinstance(snapshot, DataVersionSnapshot):
        raise ApiError("快照不存在", 404)
    rows = snapshot.snapshot_data if isinstance(snapshot.snapshot_data, list) else []
    if not rows:
        raise ApiError("快照没有可回滚数据", 400)
    target = Datasource.objects.filter(id=job.target_datasource_id).first()
    if not target:
        raise ApiError("目标数据源不存在", 404)
    cfg = _io_cfg(job, "target")
    plain = decrypt_config(target.type, target.config if isinstance(target.config, dict) else {})
    match_keys = list(job.match_keys or [])
    owner_cid = getattr(job, "client_id", "") or ""
    if owner_cid:
        # 快照回滚是批量写入：执行前整体预检（SaaS 超限拒绝；私有化告警放行）
        from open_api.entitlements import gate_rows

        gate_rows(owner_cid, len(rows))
    written = failed = 0
    errors = []
    for row in rows:
        if not isinstance(row, dict):
            failed += 1
            continue
        existing = lookup_existing(target.type, plain, cfg, row, match_keys) if match_keys else None
        operation = "update" if existing else "create"
        try:
            load_record(target.type, plain, cfg, row, operation=operation, match_keys=match_keys)
            written += 1
        except Exception as exc:
            failed += 1
            errors.append(str(exc)[:200])
    if owner_cid and written:
        from open_api.usage import bump

        bump(owner_cid, rows_written=written)
    return {
        "ok": failed == 0,
        "jobId": job.id,
        "snapshotId": snapshot.id,
        "written": written,
        "failed": failed,
        "errors": errors[:10],
        "triggeredBy": triggered_by,
    }
