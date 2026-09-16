"""数据源 CRUD 与敏感字段加解密。"""
from __future__ import annotations

from copy import deepcopy

from django.db.models import Q
from django.utils import timezone

from core.encryption import decrypt, encrypt
from core.exceptions import ApiError
from datasources.config_utils import (
    apply_defaults,
    is_masked_value,
    mask_config_for_api,
    merge_secrets,
    normalize_type,
    require_connector,
    sensitive_keys,
    validate_config,
)
from datasources.connectors.registry import test_connection as connector_test
from datasources.models import Datasource


def encrypt_config(ds_type: str, config: dict) -> dict:
    type_name, connector = require_connector(ds_type)
    result = deepcopy(config or {})
    for field in sensitive_keys(type_name, connector):
        value = result.get(field)
        if isinstance(value, str) and value and not is_masked_value(value):
            result[field] = encrypt(value)
    return result


def decrypt_config(ds_type: str, config: dict) -> dict:
    type_name = normalize_type(ds_type)
    connector = None
    try:
        type_name, connector = require_connector(type_name)
    except ApiError:
        pass
    result = deepcopy(config or {})
    for field in sensitive_keys(type_name, connector):
        value = result.get(field)
        if isinstance(value, str) and value:
            result[field] = decrypt(value)
    return result


def serialize_ds(ds: Datasource, *, reveal: bool = False) -> dict:
    from datasources.serializers import DatasourceSerializer

    data = DatasourceSerializer(ds).data
    raw = ds.config if isinstance(ds.config, dict) else {}
    data["config"] = decrypt_config(ds.type, raw) if reveal else mask_config_for_api(ds.type, decrypt_config(ds.type, raw))
    return data


def list_datasources(**filters):
    qs = Datasource.objects.all().order_by("-created_at")
    keyword = filters.get("keyword")
    if keyword:
        qs = qs.filter(Q(name__icontains=keyword) | Q(code__icontains=keyword))
    types = filters.get("types")
    if types:
        type_list = [normalize_type(t.strip()) for t in str(types).split(",") if t.strip()]
        if type_list:
            qs = qs.filter(type__in=type_list)
    elif filters.get("type"):
        qs = qs.filter(type=normalize_type(filters["type"]))
    if filters.get("status"):
        qs = qs.filter(status=filters["status"])
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


def create_datasource(data: dict, created_by: str) -> Datasource:
    type_name, _ = require_connector(data["type"])
    config = apply_defaults(type_name, data.get("config") or {})
    errors = validate_config(type_name, config)
    if errors:
        raise ApiError("请完善连接配置：" + "、".join(errors.values()), 400)
    if Datasource.objects.filter(code=data["code"]).exists():
        raise ApiError("编码已存在", 400)
    owner_cid = data.get("client_id") or ""
    # 连接器（数据源）数量门禁（0=不限）
    from open_api.entitlements import gate_resource

    gate_resource(owner_cid, "connectors")
    ds = Datasource(
        name=data["name"],
        code=data["code"],
        type=type_name,
        config=encrypt_config(type_name, config),
        description=data.get("description") or "",
        status=data.get("status") or "active",
        created_by=created_by,
        client_id=owner_cid,
        workspace_id=data.get("workspace_id") or "",
        environment=data.get("environment") or "",
    )
    if not ds.environment:
        from core.env import default_environment

        ds.environment = default_environment()
    ds.save()
    return ds


def update_datasource(ds_id: str, data: dict) -> Datasource | None:
    ds = Datasource.objects.filter(id=ds_id).first()
    if not ds:
        return None
    type_name = normalize_type(data.get("type") or ds.type)
    require_connector(type_name)
    # 客户归属不允许通过编辑变更
    data.pop("client_id", None)
    for key in ("name", "description", "status", "environment", "workspace_id"):
        if key in data and data[key] is not None:
            setattr(ds, key, data[key])
    ds.type = type_name
    if "config" in data and isinstance(data["config"], dict):
        stored = decrypt_config(ds.type, ds.config if isinstance(ds.config, dict) else {})
        merged = merge_secrets(type_name, apply_defaults(type_name, data["config"]), stored)
        errors = validate_config(type_name, merged, allow_masked=True)
        if errors:
            raise ApiError("请完善连接配置：" + "、".join(errors.values()), 400)
        ds.config = encrypt_config(type_name, merged)
    ds.save()
    return ds


def test_and_save(ds: Datasource | None, type_name: str, config: dict) -> dict:
    type_name, _ = require_connector(type_name)
    working = apply_defaults(type_name, config or {})
    if ds:
        stored = decrypt_config(ds.type, ds.config if isinstance(ds.config, dict) else {})
        working = merge_secrets(type_name, working, stored)
    result = connector_test(type_name, working)
    if ds:
        ds.last_test_status = "success" if result.get("success") else "failed"
        ds.last_test_at = timezone.now()
        ds.last_test_error = "" if result.get("success") else (result.get("message") or "")[:512]
        ds.save(update_fields=["last_test_status", "last_test_at", "last_test_error", "updated_at"])
    return result


def inspect_datasource(ds: Datasource, table: str = "") -> dict:
    from datasources.connectors.runtime import inspect_source

    cfg = decrypt_config(ds.type, ds.config if isinstance(ds.config, dict) else {})
    job_cfg = {"table": table, "path": table, "batch_size": 20, "sync_mode": "full"}
    try:
        return inspect_source(ds.type, cfg, job_cfg)
    except Exception as exc:
        code = "DRIVER_MISSING" if exc.__class__.__name__ == "DriverMissing" else "CONNECTOR_UNSUPPORTED"
        raise ApiError(str(exc), 400, code=code) from exc
