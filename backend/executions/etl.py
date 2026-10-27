"""
ETL 执行器：Extract → Transform → Load。

入站 Webhook / 死信重放通过 payload 跳过 Extract。
"""
from __future__ import annotations

import traceback
from datetime import timedelta

from django.utils import timezone

from datasources.connectors.runtime import (
    MQ_TYPES,
    extract_records,
    http_existing_map,
    load_record,
    lookup_existing,
    record_key,
)
from datasources.connectors.watermark import greater as _wm_greater, geq as _wm_geq
from datasources.config_utils import normalize_type
from datasources.models import Datasource
from datasources.services import decrypt_config
from executions.alerts import notify_failure_alert
from executions.callback import notify_execution
from executions.models import DataVersionSnapshot, FieldChangeAudit
from executions.pipeline import desensitize_record, fingerprint, jsonable, make_sync_decision, resolve_sensitive_fields
from executions.services import add_dead_letter, finish_dead_letter_retry, purge_expired_snapshots, update_execution
from jobs.mapping import transform_batch
from jobs.models import IntegrationJob


def _io_cfg(job: IntegrationJob, which: str) -> dict:
    raw = getattr(job, f"{which}_config") or {}
    cfg = dict(raw) if isinstance(raw, dict) else {}
    cfg["watermark_field"] = job.watermark_field
    cfg["watermark_value"] = job.watermark_value or ""
    cfg["sync_mode"] = job.sync_mode
    cfg["batch_size"] = job.batch_size
    cfg["filter_condition"] = job.filter_condition or ""
    return cfg


def _plain_config(ds: Datasource) -> dict:
    return decrypt_config(ds.type, ds.config if isinstance(ds.config, dict) else {})


def _invert_mappings(mappings) -> list[dict]:
    inverted = []
    for item in mappings or []:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row["source"], row["target"] = item.get("target"), item.get("source")
        inverted.append(row)
    return inverted


def _apply_reverse(job: IntegrationJob) -> None:
    """仅在本次执行内存中对调源/目标与映射，不写回任务配置。"""
    if (job.sync_direction or "forward") != "reverse":
        return
    job.source_datasource_id, job.target_datasource_id = job.target_datasource_id, job.source_datasource_id
    job.source_config, job.target_config = job.target_config or {}, job.source_config or {}
    job.field_mapping = _invert_mappings(job.field_mapping)


def _advance_watermark(records: list[dict], field: str, current: str) -> str:
    if not field:
        return current or ""
    best = current or ""
    for row in records:
        value = row.get(field)
        if _wm_greater(value, best):
            best = value
    return "" if best in (None, "") else str(best)


def _finish(job, execution_id, started, *, status, records, written, failed, skipped, watermark, error="", will_retry=False):
    finished = timezone.now()
    duration = int((finished - started).total_seconds() * 1000)
    update_execution(
        execution_id,
        status=status,
        finished_at=finished,
        duration_ms=duration,
        total_rows=len(records),
        success_rows=written,
        failed_rows=failed,
        skipped_rows=skipped,
        start_watermark=job.watermark_value or "",
        end_watermark=watermark or job.watermark_value or "",
        error_message=(error or "")[:2000],
    )
    job.last_execution_at = finished
    updates = ["last_execution_at", "updated_at"]
    if watermark and job.sync_mode == "incremental" and status != "failed":
        job.last_watermark_value = job.watermark_value or ""
        job.watermark_value = watermark
        updates.extend(["watermark_value", "last_watermark_value"])
    if status == "failed" and not will_retry:
        job.status = "error"
        updates.append("status")
    elif status != "failed" and job.status == "error":
        # 执行成功后恢复任务状态为 running（之前因失败被置为 error）
        job.status = "running"
        updates.append("status")
    job.save(update_fields=updates)
    notify_execution(
        job,
        execution_id=execution_id,
        payload={
            "status": status,
            "totalRows": len(records),
            "successRows": written,
            "failedRows": failed,
            "skippedRows": skipped,
            "watermark": job.watermark_value or "",
            "errorMessage": error or "",
        },
    )
    if not will_retry:
        notify_failure_alert(job, {
            "status": status,
            "executionId": execution_id,
            "totalRows": len(records),
            "successRows": written,
            "failedRows": failed,
            "errorMessage": error or "",
        })
    owner = getattr(job, "client_id", "") or ""
    if written and owner:
        from open_api.usage import bump

        bump(owner, rows_written=written)


def run_etl(job_data: dict) -> dict:
    job_id = job_data["jobId"]
    execution_id = job_data["executionId"]
    started = timezone.now()
    update_execution(execution_id, status="running", started_at=started)

    job = IntegrationJob.objects.filter(id=job_id).first()
    if not job:
        update_execution(
            execution_id,
            status="failed",
            finished_at=timezone.now(),
            error_message="任务不存在",
        )
        return {"ok": False, "error": "任务不存在"}

    try:
        step = job_data.get("step") if isinstance(job_data.get("step"), dict) else None
        if job_data.get("delegateJobId"):
            delegated = IntegrationJob.objects.filter(id=job_data["delegateJobId"]).first()
            if delegated:
                job = delegated
        if step:
            if step.get("sourceDatasourceId") or step.get("source_datasource_id"):
                job.source_datasource_id = step.get("sourceDatasourceId") or step.get("source_datasource_id")
            if step.get("targetDatasourceId") or step.get("target_datasource_id"):
                job.target_datasource_id = step.get("targetDatasourceId") or step.get("target_datasource_id")
            if step.get("sourceConfig") or step.get("source_config"):
                job.source_config = step.get("sourceConfig") or step.get("source_config") or job.source_config
            if step.get("targetConfig") or step.get("target_config"):
                job.target_config = step.get("targetConfig") or step.get("target_config") or job.target_config
            if step.get("fieldMapping") or step.get("field_mapping"):
                job.field_mapping = step.get("fieldMapping") or step.get("field_mapping") or job.field_mapping

        _apply_reverse(job)

        source_ds = Datasource.objects.filter(id=job.source_datasource_id).first() if job.source_datasource_id else None
        target_ds = Datasource.objects.filter(id=job.target_datasource_id).first() if job.target_datasource_id else None

        records = job_data.get("payload")
        pushed = records is not None
        if isinstance(records, dict):
            records = [records]
        if not target_ds:
            raise RuntimeError("目标数据源不存在")
        if not pushed:
            if not source_ds:
                raise RuntimeError("未配置源数据源：Webhook 推数请在请求体带 records，或给任务选择源")
            records = extract_records(source_ds.type, _plain_config(source_ds), _io_cfg(job, "source"))
        elif not isinstance(records, list):
            records = []
        records = [jsonable(r) for r in records if isinstance(r, dict)]

        if (
            (not pushed)
            and job.sync_mode == "incremental"
            and job.watermark_field
            and job.watermark_value
        ):
            # >= 对齐 SQL/MongoDB/ES 查询层（边界行 Load 失败时下次还能拉到）
            records = [r for r in records if _wm_geq(r.get(job.watermark_field), job.watermark_value)]

        from jobs.filter_expr import apply_filter

        records = apply_filter(records, job.filter_condition)

        mappings = job.field_mapping or []
        status_mapping = None
        if job.template_type:
            from org_sync.templates import get_template

            tpl = get_template(job.template_type)
            if tpl:
                status_mapping = tpl.get("statusMapping")
        # Transform 前建索引：Transform 后按 match_keys 能找回原始行
        # —— 保证水位线字段即使被 Transform 改名也能从原始行读到
        match_keys = list(job.match_keys or [])
        orig_by_key: dict[str, dict] = {}
        for orig in records:
            if match_keys:
                k = record_key(orig, match_keys)
                if k:
                    orig_by_key[k] = orig
        if mappings:
            transformed = transform_batch(records, mappings, status_mapping=status_mapping)
        elif status_mapping:
            from jobs.mapping import apply_status_mapping

            transformed = {
                "success": [apply_status_mapping(r, dict(r), status_mapping) for r in records],
                "failed": [],
            }
        else:
            transformed = {"success": records, "failed": []}
        from executions.loop_guard import is_echo, stamp

        soft_del_field = (job.soft_delete_field or "").strip()
        soft_del_value = (job.soft_delete_value or "").strip()
        echo_skipped = 0
        kept = []
        for row in transformed["success"]:
            if is_echo(row, job):
                echo_skipped += 1
                continue
            # P1-2：delete 分支跳过 stamp——软删信号是源端自身的离职/下架记录，
            # 不是双向同步的"回环"概念。stamp 了反而会让下一轮 is_echo 误判为回环而 skip，
            # 导致 delete 信号永远发不出去。
            if soft_del_field and soft_del_value and str(row.get(soft_del_field, "") or "") == soft_del_value:
                kept.append(row)
            else:
                kept.append(stamp(row, job))
        success_rows = kept
        failed_items = transformed["failed"]
        skipped = echo_skipped
        written = 0
        load_failed = 0
        # Load 成功行的原始版本（用于算水位线，避免 Transform 改名）
        written_rows_for_watermark: list[dict] = []
        target_cfg = _io_cfg(job, "target")
        target_plain = _plain_config(target_ds)

        owner_cid = getattr(job, "client_id", "") or ""
        if success_rows:
            # 写入前行数门禁：SaaS 超限整体拦截且不写任何行；私有化告警后放行
            from open_api.entitlements import gate_rows

            if not gate_rows(owner_cid, len(success_rows), raise_on_deny=False):
                finished = timezone.now()
                msg = "本月写入行数超过授权上限，本次执行已拦截（未写入目标）"
                update_execution(
                    execution_id,
                    status="failed",
                    finished_at=finished,
                    duration_ms=int((finished - started).total_seconds() * 1000),
                    total_rows=len(records),
                    success_rows=0,
                    failed_rows=len(success_rows),
                    skipped_rows=skipped,
                    start_watermark=job.watermark_value or "",
                    end_watermark=job.watermark_value or "",
                    error_message=msg,
                )
                notify_execution(
                    job,
                    execution_id=execution_id,
                    payload={
                        "status": "failed",
                        "totalRows": len(records),
                        "successRows": 0,
                        "failedRows": len(success_rows),
                        "skippedRows": skipped,
                        "watermark": job.watermark_value or "",
                        "errorMessage": msg,
                    },
                )
                from monitor.metrics import observe_etl

                observe_etl(
                    status="failed",
                    duration_ms=int((finished - started).total_seconds() * 1000),
                    success_rows=0,
                    failed_rows=len(success_rows),
                    skipped_rows=skipped,
                    environment=getattr(job, "environment", "") or "dev",
                )
                if not job_data.get("workflowRunId"):
                    from executions.events import emit_job_event

                    emit_job_event(job, status="failed", triggered_by=job.code)
                # 不推进水位、不改任务状态、不触发重试：下个计费周期可直接重跑
                return {"ok": False, "status": "quota_exceeded", "successRows": 0, "failedRows": len(success_rows)}

        if job.enable_version_snapshot and success_rows:
            DataVersionSnapshot.objects.create(
                job_id=job.id,
                execution_id=execution_id,
                version=job.version,
                snapshot_type="before",
                record_count=len(success_rows),
                snapshot_data=jsonable(success_rows[:200]),
                expires_at=timezone.now() + timedelta(days=job.version_retention_days or 30),
            )
            purge_expired_snapshots()

        existing_map: dict[str, dict] = {}
        if match_keys and job.write_mode != "insert":
            target_kind = normalize_type(target_ds.type)
            if target_kind in ("http_api", "webhook"):
                existing_map = http_existing_map(target_plain, target_cfg, match_keys)
            elif target_kind in MQ_TYPES:
                from datasources.connectors import mq_runtime

                existing_map = mq_runtime.fetch_existing_map(target_kind, target_plain, target_cfg, match_keys)

        for row in success_rows:
            existing = None
            if match_keys:
                if existing_map:
                    existing = existing_map.get(record_key(row, match_keys))
                else:
                    existing = lookup_existing(target_ds.type, target_plain, target_cfg, row, match_keys)
            decision = make_sync_decision(
                existing=existing,
                incoming=row,
                strategy=job.conflict_strategy,
                compare_field=job.conflict_compare_field or "",
                soft_delete_field=job.soft_delete_field or "",
                soft_delete_value=job.soft_delete_value or "",
            )
            if job.write_mode == "update_only" and decision == "create":
                skipped += 1
                continue
            if job.write_mode == "insert" and existing is not None:
                skipped += 1
                continue
            if decision == "skip":
                skipped += 1
                continue
            if decision == "conflict":
                add_dead_letter(
                    job_id=job.id,
                    execution_id=execution_id,
                    payload=row,
                    error_message="冲突需人工介入",
                    error_type="conflict",
                    sensitive_fields=job.sensitive_fields,
                    desensitize_mode=job.desensitize_mode,
                )
                load_failed += 1
                continue
            operation = "delete" if decision == "delete" else ("update" if decision == "update" else "create")
            try:
                load_record(
                    target_ds.type, target_plain, target_cfg, row,
                    operation=operation, match_keys=match_keys,
                )
            except Exception as exc:
                add_dead_letter(
                    job_id=job.id,
                    execution_id=execution_id,
                    payload=row,
                    error_message=str(exc)[:2000],
                    error_type="load",
                    sensitive_fields=job.sensitive_fields,
                    desensitize_mode=job.desensitize_mode,
                )
                load_failed += 1
                continue
            written += 1
            # 记录 Load 成功的原始行用于水位线推进
            if match_keys:
                orig_row = orig_by_key.get(record_key(row, match_keys))
                if orig_row:
                    written_rows_for_watermark.append(orig_row)
            if operation == "delete":
                try:
                    from monitor.metrics import observe_delete
                    observe_delete(connector=target_ds.type, environment=getattr(job, "environment", "") or "dev")
                except Exception:
                    pass
            if job.enable_change_audit:
                audit_fields = resolve_sensitive_fields({**(existing or {}), **row}, job.sensitive_fields)
                safe_row = desensitize_record(row, audit_fields, job.desensitize_mode)
                safe_existing = desensitize_record(existing, audit_fields, job.desensitize_mode) if existing else None
                FieldChangeAudit.objects.create(
                    job_id=job.id,
                    execution_id=execution_id,
                    record_key=str(row.get((match_keys[0] if match_keys else "id"), written)),
                    operation=operation,
                    changes=[
                        {
                            "field": k,
                            "oldValue": None if safe_existing is None else safe_existing.get(k),
                            "newValue": v,
                        }
                        for k, v in safe_row.items()
                    ],
                    after_hash=fingerprint(row),
                )

        for item in failed_items:
            add_dead_letter(
                job_id=job.id,
                execution_id=execution_id,
                payload=item.get("record") or {},
                error_message=item.get("error") or "",
                error_type="transform",
                sensitive_fields=job.sensitive_fields,
                desensitize_mode=job.desensitize_mode,
            )

        failed_count = len(failed_items) + load_failed
        status = "success"
        if failed_count and written:
            status = "partial_failed"
        elif failed_count and not written:
            status = "failed"
        # 水位线推进策略：
        # - success / partial_failed：从 Load 成功的行（written 条）里算 max，
        #   失败的行留给死信处理，水位线不能"跨过"它们。
        # - failed：不推进。
        if status == "failed":
            watermark = job.watermark_value or ""
        elif written:
            watermark = _advance_watermark(written_rows_for_watermark, job.watermark_field, job.watermark_value or "")
        else:
            watermark = _advance_watermark(records, job.watermark_field, job.watermark_value or "")
        retrying = False
        if status == "failed" and not job_data.get("deadLetterId"):
            from executions.services import schedule_retry

            retrying = bool(schedule_retry(job, job_data))
        _finish(
            job, execution_id, started,
            status=status, records=records, written=written,
            failed=failed_count, skipped=skipped, watermark=watermark,
            will_retry=retrying,
        )
        finish_dead_letter_retry(job_data.get("deadLetterId") or "", success=status != "failed")
        from monitor.metrics import observe_etl

        observe_etl(
            status=status,
            duration_ms=int((timezone.now() - started).total_seconds() * 1000),
            success_rows=written,
            failed_rows=failed_count,
            skipped_rows=skipped,
            environment=getattr(job, "environment", "") or "dev",
        )
        if retrying:
            return {"ok": False, "status": "failed", "retrying": True, "successRows": written, "failedRows": failed_count}
        if not job_data.get("workflowRunId"):
            from executions.events import emit_job_event

            emit_job_event(job, status=status, triggered_by=job.code)
        if (
            status != "failed"
            and (job.sync_direction or "forward") == "bidirectional"
            and job.pair_job_id
            and job_data.get("triggerType") != "pair"
        ):
            pair = IntegrationJob.objects.filter(id=job.pair_job_id).first()
            if pair:
                from executions.services import enqueue_execution

                enqueue_execution(pair, trigger_type="pair", triggered_by=job.code)
        return {"ok": status != "failed", "status": status, "successRows": written, "failedRows": failed_count}
    except Exception as exc:
        finished = timezone.now()
        update_execution(
            execution_id,
            status="failed",
            finished_at=finished,
            duration_ms=int((finished - started).total_seconds() * 1000),
            error_message=str(exc)[:2000],
            error_stack=traceback.format_exc()[:4000],
        )
        retrying = False
        if not job_data.get("deadLetterId"):
            from executions.services import schedule_retry

            retrying = bool(schedule_retry(job, job_data))
        if not retrying:
            job.status = "error"
            job.save(update_fields=["status", "updated_at"])
        finish_dead_letter_retry(job_data.get("deadLetterId") or "", success=False)
        notify_execution(
            job,
            execution_id=execution_id,
            payload={
                "status": "failed",
                "totalRows": 0,
                "successRows": 0,
                "failedRows": 0,
                "skippedRows": 0,
                "watermark": job.watermark_value or "",
                "errorMessage": str(exc)[:2000],
            },
        )
        if not retrying:
            notify_failure_alert(job, {
                "status": "failed",
                "executionId": execution_id,
                "errorMessage": str(exc)[:2000],
            })
            if not job_data.get("workflowRunId"):
                from executions.events import emit_job_event

                emit_job_event(job, status="failed", triggered_by=job.code)
        return {"ok": False, "error": str(exc), "retrying": retrying}
