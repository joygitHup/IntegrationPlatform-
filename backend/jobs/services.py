"""集成任务服务。"""
from __future__ import annotations

from django.db.models import Q

from core.exceptions import ApiError
from jobs.job_utils import prepare_job_data
from jobs.models import IntegrationJob


def list_jobs(**filters):
    qs = IntegrationJob.objects.all().order_by("-created_at")
    keyword = filters.get("keyword")
    if keyword:
        qs = qs.filter(Q(name__icontains=keyword) | Q(code__icontains=keyword))
    if filters.get("status"):
        qs = qs.filter(status=filters["status"])
    if filters.get("sync_mode"):
        qs = qs.filter(sync_mode=filters["sync_mode"])
    if filters.get("source_datasource_id"):
        qs = qs.filter(source_datasource_id=filters["source_datasource_id"])
    if filters.get("target_datasource_id"):
        qs = qs.filter(target_datasource_id=filters["target_datasource_id"])
    if filters.get("partner_id"):
        from open_api.tenancy import partner_q

        qs = qs.filter(partner_q(filters["partner_id"]))
    elif filters.get("created_by"):
        qs = qs.filter(created_by=filters["created_by"])
    if filters.get("client_id"):
        qs = qs.filter(client_id=filters["client_id"])
    if filters.get("environment"):
        qs = qs.filter(environment=filters["environment"])
    if filters.get("workspace_id"):
        from open_api.tenancy import workspace_q

        qs = qs.filter(workspace_q(filters["workspace_id"], partner=bool(filters.get("partner_id"))))
    return qs


def _assert_datasources_in_client(client_id: str, source_id: str, target_id: str) -> None:
    """客户任务只能引用本客户的数据源，杜绝借任务抽取/写入他客数据。"""
    if not client_id:
        return
    from datasources.models import Datasource

    for did in (source_id, target_id):
        if not did:
            continue
        ds = Datasource.objects.filter(id=did).first()
        if ds is None:
            raise ApiError("关联的数据源不存在", 400, code="VALIDATION")
        if (ds.client_id or "") != client_id:
            raise ApiError("数据源不属于当前客户", 403, code="FORBIDDEN_TENANT")


def create_job(data: dict, created_by: str) -> IntegrationJob:
    data = prepare_job_data(data, partial=False)
    if IntegrationJob.objects.filter(code=data["code"]).exists():
        raise ApiError("任务编码已存在", 400)
    owner_cid = data.get("client_id") or ""
    _assert_datasources_in_client(owner_cid, data.get("source_datasource_id") or "", data.get("target_datasource_id") or "")
    # 集成任务数量门禁（0=不限）
    from open_api.entitlements import gate_resource

    gate_resource(owner_cid, "jobs")
    job = IntegrationJob(
        name=data["name"],
        code=data["code"],
        description=data.get("description") or "",
        source_datasource_id=data.get("source_datasource_id") or "",
        target_datasource_id=data.get("target_datasource_id") or "",
        source_config=data.get("source_config") or {},
        target_config=data.get("target_config") or {},
        field_mapping=data.get("field_mapping") or [],
        filter_condition=data.get("filter_condition") or "",
        sync_mode=data.get("sync_mode") or "full",
        watermark_strategy=data.get("watermark_strategy") or "timestamp",
        watermark_field=data.get("watermark_field") or "",
        schedule_type=data.get("schedule_type") or "manual",
        schedule_cron=data.get("schedule_cron") or "",
        batch_size=data.get("batch_size") or 1000,
        concurrency=data.get("concurrency") or 1,
        retry_count=data.get("retry_count") if data.get("retry_count") is not None else 3,
        retry_interval=data.get("retry_interval") if data.get("retry_interval") is not None else 60,
        write_mode=data.get("write_mode") or "insert",
        match_keys=data.get("match_keys") or [],
        conflict_strategy=data.get("conflict_strategy") or "source_wins",
        conflict_compare_field=data.get("conflict_compare_field") or "",
        sensitive_fields=data.get("sensitive_fields") or [],
        desensitize_mode=data.get("desensitize_mode") or "mask",
        enable_change_audit=bool(data.get("enable_change_audit")),
        enable_version_snapshot=bool(data.get("enable_version_snapshot")),
        version_retention_days=data.get("version_retention_days") or 30,
        template_type=data.get("template_type") or "generic",
        callback_url=data.get("callback_url") or "",
        webhook_secret=data.get("webhook_secret") or "",
        alert_email=data.get("alert_email") or "",
        alert_webhook_url=data.get("alert_webhook_url") or "",
        dag_steps=data.get("dag_steps") or [],
        sync_direction=data.get("sync_direction") or "forward",
        origin_marker_field=data.get("origin_marker_field") or "_ip_origin",
        origin_system_id=data.get("origin_system_id") or data.get("code") or "",
        pair_job_id=data.get("pair_job_id") or "",
        environment=data.get("environment") or "",
        workspace_id=data.get("workspace_id") or "",
        client_id=data.get("client_id") or "",
        created_by=created_by,
        status="stopped",
    )
    if not job.environment:
        from core.env import default_environment

        job.environment = default_environment()
    if not job.origin_system_id:
        job.origin_system_id = job.code
    job.save()
    return job


def update_job(job_id: str, data: dict) -> IntegrationJob | None:
    job = IntegrationJob.objects.filter(id=job_id).first()
    if not job:
        return None
    data = prepare_job_data(data, partial=True, existing=job)
    # 客户归属不允许通过编辑变更
    data.pop("client_id", None)
    owner_cid = job.client_id or ""
    if owner_cid:
        _assert_datasources_in_client(
            owner_cid,
            data.get("source_datasource_id") if data.get("source_datasource_id") is not None else job.source_datasource_id,
            data.get("target_datasource_id") if data.get("target_datasource_id") is not None else job.target_datasource_id,
        )
    skip = {"id", "created_at", "created_by", "code", "watermark_value", "last_watermark_value", "last_execution_at"}
    for key, value in data.items():
        if key in skip or not hasattr(job, key):
            continue
        setattr(job, key, value)
    job.version = (job.version or 1) + 1
    job.save()
    return job


def set_job_status(job_id: str, status: str) -> IntegrationJob:
    job = IntegrationJob.objects.filter(id=job_id).first()
    if not job:
        raise ApiError("任务不存在", 404)
    if status == "running" and job.schedule_type == "manual":
        raise ApiError("手动触发的任务无需启动调度", 400)
    job.status = status
    job.save(update_fields=["status", "updated_at"])
    return job


def assert_accepts_push(job) -> None:
    if getattr(job, "status", "") != "running":
        raise ApiError("任务未启动，拒绝接收推数", 409, code="JOB_STOPPED")


def _unique_code(model, base: str, env: str) -> str:
    suffix = (env or "prod").replace("-", "_")
    code = f"{base}_{suffix}"[:64]
    n = 1
    while model.objects.filter(code=code).exists():
        n += 1
        extra = f"_{n}"
        code = f"{base}_{suffix}"[: 64 - len(extra)] + extra
    return code


def _clone_datasource(ds, *, environment: str, created_by: str, workspace_id: str):
    from datasources.models import Datasource

    suffix = (environment or "prod").replace("-", "_")
    expected = f"{ds.code}_{suffix}"[:64]
    existing = Datasource.objects.filter(code=expected, environment=environment).first()
    if existing:
        return existing
    # 环境提升会新建连接器：受连接器数量门禁
    from open_api.entitlements import gate_resource

    gate_resource(getattr(ds, "client_id", "") or "", "connectors")
    clone = Datasource(
        name=f"{ds.name} ({environment})",
        code=_unique_code(Datasource, ds.code, environment),
        type=ds.type,
        config=ds.config if isinstance(ds.config, dict) else {},
        description=ds.description,
        status="active",
        created_by=created_by or ds.created_by,
        client_id=getattr(ds, "client_id", "") or "",
        workspace_id=workspace_id or ds.workspace_id,
        environment=environment,
    )
    clone.save()
    return clone


def _existing_promoted(job: IntegrationJob, target_env: str) -> IntegrationJob | None:
    suffix = (target_env or "prod").replace("-", "_")
    prefix = f"{job.code}_{suffix}"
    qs = IntegrationJob.objects.filter(environment=target_env)
    found = qs.filter(code=prefix).first()
    if found:
        return found
    return qs.filter(code__startswith=prefix).order_by("created_at").first()


def _link_promoted_pair(source_job: IntegrationJob, clone: IntegrationJob, *, target_env: str, created_by: str) -> None:
    pair_id = (source_job.pair_job_id or "").strip()
    if not pair_id or pair_id == source_job.id:
        return
    pair = IntegrationJob.objects.filter(id=pair_id).first()
    if not pair:
        return
    if (pair.environment or "dev") == target_env:
        peer = pair
    else:
        peer = _existing_promoted(pair, target_env)
        if not peer:
            try:
                peer = promote_job(pair, target_env=target_env, created_by=created_by, _pairing=False)
            except ApiError:
                return
    clone.pair_job_id = peer.id
    clone.save(update_fields=["pair_job_id", "updated_at"])
    if peer.pair_job_id != clone.id:
        peer.pair_job_id = clone.id
        peer.save(update_fields=["pair_job_id", "updated_at"])


def promote_job(job: IntegrationJob, *, target_env: str = "prod", created_by: str = "", _pairing: bool = True) -> IntegrationJob:
    from datasources.models import Datasource

    target_env = (target_env or "prod").strip().lower()
    if target_env not in ("dev", "staging", "prod"):
        raise ApiError("目标环境无效", 400, code="VALIDATION")
    if (job.environment or "dev") == target_env:
        raise ApiError("任务已在目标环境", 400, code="VALIDATION")
    # 提升会生成新任务：受任务数量门禁
    from open_api.entitlements import gate_resource

    gate_resource(getattr(job, "client_id", "") or "", "jobs")
    source = Datasource.objects.filter(id=job.source_datasource_id).first()
    target = Datasource.objects.filter(id=job.target_datasource_id).first()
    if not source or not target:
        raise ApiError("源或目标数据源不存在", 400, code="NOT_FOUND")
    owner = created_by or job.created_by
    ws = job.workspace_id or ""
    new_source = _clone_datasource(source, environment=target_env, created_by=owner, workspace_id=ws)
    new_target = _clone_datasource(target, environment=target_env, created_by=owner, workspace_id=ws)
    clone = IntegrationJob(
        name=f"{job.name} ({target_env})",
        code=_unique_code(IntegrationJob, job.code, target_env),
        description=job.description,
        source_datasource_id=new_source.id,
        target_datasource_id=new_target.id,
        source_config=job.source_config or {},
        target_config=job.target_config or {},
        field_mapping=job.field_mapping or [],
        filter_condition=job.filter_condition,
        sync_mode=job.sync_mode,
        watermark_strategy=job.watermark_strategy,
        watermark_field=job.watermark_field,
        schedule_type=job.schedule_type or "manual",
        schedule_cron=job.schedule_cron or "",
        batch_size=job.batch_size,
        concurrency=job.concurrency,
        retry_count=job.retry_count,
        retry_interval=job.retry_interval,
        write_mode=job.write_mode,
        match_keys=job.match_keys or [],
        conflict_strategy=job.conflict_strategy,
        conflict_compare_field=job.conflict_compare_field,
        callback_url=job.callback_url,
        webhook_secret=job.webhook_secret,
        alert_email=job.alert_email,
        alert_webhook_url=job.alert_webhook_url,
        sensitive_fields=job.sensitive_fields or [],
        desensitize_mode=job.desensitize_mode,
        enable_change_audit=job.enable_change_audit,
        enable_version_snapshot=job.enable_version_snapshot,
        version_retention_days=job.version_retention_days,
        template_type=job.template_type,
        dag_steps=job.dag_steps or [],
        sync_direction=job.sync_direction,
        origin_marker_field=job.origin_marker_field,
        origin_system_id=job.origin_system_id,
        pair_job_id="",
        environment=target_env,
        workspace_id=ws,
        client_id=getattr(job, "client_id", "") or "",
        created_by=owner,
        status=job.status if job.status in ("running", "paused") else "stopped",
    )
    clone.save()
    if _pairing:
        _link_promoted_pair(job, clone, target_env=target_env, created_by=owner)
    return clone


def preview_mapping(*, datasource, source_config: dict | None = None, field_mapping: list | None = None, filter_condition: str | None = None, limit: int = 20) -> dict:
    from datasources.connectors.runtime import extract_records, inspect_source
    from datasources.services import decrypt_config
    from jobs.filter_expr import FilterError, apply_filter
    from jobs.job_utils import normalize_mappings
    from jobs.mapping import transform_batch, validate_mappings

    cfg = decrypt_config(datasource.type, datasource.config if isinstance(datasource.config, dict) else {})
    job_cfg = dict(source_config or {})
    job_cfg.setdefault("batch_size", max(1, min(int(limit or 20), 50)))
    job_cfg["sync_mode"] = "full"
    job_cfg["filter_condition"] = filter_condition or ""
    schema = {}
    sample: list[dict] = []
    try:
        schema = inspect_source(datasource.type, cfg, job_cfg)
        sample = list(schema.get("sample") or [])[: job_cfg["batch_size"]]
        if not sample:
            sample = extract_records(datasource.type, cfg, job_cfg)[: job_cfg["batch_size"]]
        sample = apply_filter(sample, filter_condition)
    except FilterError as exc:
        raise ApiError(str(exc), 400, code="VALIDATION") from exc
    except Exception as exc:
        code = "DRIVER_MISSING" if exc.__class__.__name__ == "DriverMissing" else "CONNECTOR_UNSUPPORTED"
        raise ApiError(str(exc), 400, code=code) from exc
    mappings = normalize_mappings(field_mapping or [])
    check = validate_mappings(mappings) if mappings else {"valid": True, "errors": []}
    transformed = transform_batch(sample, mappings) if mappings else {"success": sample, "failed": []}
    columns = [c.get("name") for c in (schema.get("tables") and schema.get("columns") or []) if c.get("name")]
    if not columns:
        columns = [c.get("name") for c in (schema.get("columns") or []) if c.get("name")]
    if not columns:
        columns = sorted({k for row in sample for k in row.keys()})
    return {
        "columns": columns,
        "tables": schema.get("tables") or [],
        "sample": sample[:5],
        "preview": (transformed.get("success") or [])[:5],
        "transformErrors": (transformed.get("failed") or [])[:5],
        "mapping": check,
    }
