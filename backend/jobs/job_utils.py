"""
集成任务入参归一：数据源校验、Cron、字段映射。

映射规则字段与前端 FieldMapping 对齐：
  source / target / transform / defaultValue / required / params
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from core.exceptions import ApiError
from datasources.models import Datasource
from executions.pipeline import DESENSITIZE_MODES
from jobs.mapping import validate_mappings

JOB_CODE_PATTERN = r"^[a-zA-Z][a-zA-Z0-9_-]*$"

# 前端 TRANSFORM_OPTIONS → 引擎内部名；同时接受历史 snake_case
TRANSFORM_ALIASES = {
    "to_int": "toInt",
    "to_float": "toFloat",
    "to_number": "toFloat",
    "to_string": "toString",
    "to_date": "toDate",
    "default_value": "defaultValue",
    "status_map": "statusMap",
    "none": "",
}


def normalize_transform(value: Any) -> str:
    text = "" if value is None else str(value).strip()
    if text in TRANSFORM_ALIASES:
        return TRANSFORM_ALIASES[text]
    return text


def normalize_mapping(item: Any) -> dict | None:
    if not isinstance(item, dict):
        return None
    source = str(item.get("source") or "").strip()
    target = str(item.get("target") or "").strip()
    if not source or not target:
        return None
    mapping: dict[str, Any] = {"source": source, "target": target}
    transform = normalize_transform(item.get("transform"))
    if transform:
        mapping["transform"] = transform
    default_value = item.get("defaultValue", item.get("default_value"))
    if default_value not in (None, ""):
        mapping["defaultValue"] = default_value
    if item.get("required"):
        mapping["required"] = True
    params = item.get("params")
    if isinstance(params, dict) and params:
        mapping["params"] = params
    return mapping


def normalize_mappings(items: Any) -> list[dict]:
    result = []
    for item in items or []:
        mapping = normalize_mapping(item)
        if mapping:
            result.append(mapping)
    return result


def normalize_io_config(config: Any) -> dict:
    if not isinstance(config, dict):
        return {}
    result = deepcopy(config)
    table = result.get("table") or result.get("path")
    if table not in (None, ""):
        value = str(table).strip()
        result["table"] = value
        result.setdefault("path", value)
    return result


def require_datasource(ds_id: str, role: str) -> Datasource:
    ds = Datasource.objects.filter(id=ds_id).first()
    if not ds:
        raise ApiError(f"{role}数据源不存在", 400)
    if ds.status == "disabled":
        raise ApiError(f"{role}数据源已禁用: {ds.name}", 400)
    return ds


def valid_cron(expr: str) -> bool:
    from jobs.cron import valid_cron as _valid

    return _valid(expr)


def prepare_job_data(data: dict, *, partial: bool = False, existing=None) -> dict:
    """校验并归一化创建/更新入参（已是 snake_case 顶层字段）。"""
    result = dict(data)

    if "dag_steps" in result and isinstance(result.get("dag_steps"), list):
        from executions.dag import has_cycle, normalize_steps

        result["dag_steps"] = normalize_steps(result.get("dag_steps"))
        if has_cycle(result["dag_steps"]):
            raise ApiError("DAG 存在依赖环，无法保存", 400)

    has_dag = bool(result.get("dag_steps") or (getattr(existing, "dag_steps", None) if existing else None))
    schedule = result.get("schedule_type") if "schedule_type" in result else (getattr(existing, "schedule_type", None) if existing else "manual")
    push_only = (schedule or "") == "webhook"

    if has_dag and result.get("dag_steps"):
        first = result["dag_steps"][0]
        result.setdefault("source_datasource_id", first.get("sourceDatasourceId") or first.get("source_datasource_id"))
        result.setdefault("target_datasource_id", first.get("targetDatasourceId") or first.get("target_datasource_id"))

    if "source_config" in result:
        result["source_config"] = normalize_io_config(result.get("source_config"))
    if "target_config" in result:
        result["target_config"] = normalize_io_config(result.get("target_config"))

    if "field_mapping" in result:
        result["field_mapping"] = normalize_mappings(result.get("field_mapping"))
        check = validate_mappings(result["field_mapping"])
        if not check["valid"]:
            raise ApiError("字段映射验证失败: " + "；".join(check["errors"]), 400)
        if not result["field_mapping"] and not has_dag:
            raise ApiError("至少配置一条有效的字段映射", 400)
    elif not partial and not has_dag:
        raise ApiError("至少配置一条有效的字段映射", 400)

    source_id = result.get("source_datasource_id") or (getattr(existing, "source_datasource_id", None) if existing else None)
    target_id = result.get("target_datasource_id") or (getattr(existing, "target_datasource_id", None) if existing else None)
    if not partial or "source_datasource_id" in result:
        if source_id:
            require_datasource(source_id, "源")
        elif not has_dag and not push_only:
            raise ApiError("请选择源数据源", 400)
    if not partial or "target_datasource_id" in result:
        if target_id:
            target_ds = require_datasource(target_id, "目标")
            from datasources.connectors.runtime import IDENTITY_TYPES
            from datasources.config_utils import normalize_type

            if normalize_type(target_ds.type) in IDENTITY_TYPES:
                raise ApiError("钉钉 / 企微 / AD / LDAP 只能作为抽取源，请把数据库、HTTP 或 SCIM 配成目标", 400)
        elif not has_dag:
            raise ApiError("请选择目标数据源", 400)

    sync_mode = result.get("sync_mode") if "sync_mode" in result else (getattr(existing, "sync_mode", None) if existing else "full")
    sync_mode = sync_mode or "full"
    watermark = result.get("watermark_field") if "watermark_field" in result else (getattr(existing, "watermark_field", "") if existing else "")
    if sync_mode == "incremental" and not str(watermark or "").strip():
        raise ApiError("增量同步需指定水位字段", 400)
    if sync_mode != "incremental":
        result["watermark_field"] = result.get("watermark_field") or ""

    schedule_type = result.get("schedule_type") if "schedule_type" in result else (getattr(existing, "schedule_type", None) if existing else "manual")
    schedule_type = schedule_type or "manual"
    cron = result.get("schedule_cron") if "schedule_cron" in result else (getattr(existing, "schedule_cron", "") if existing else "")
    if schedule_type == "cron":
        if not str(cron or "").strip():
            raise ApiError("定时调度需填写 Cron 表达式", 400)
        if not valid_cron(str(cron)):
            raise ApiError("Cron 表达式无效，支持 5/6 段以及 */n、a-b、逗号列表、MON-FRI", 400)
    elif schedule_type == "event":
        name = str(cron or "").strip()
        if not name:
            raise ApiError("事件触发需填写事件名，例如 job.completed", 400)
        result["schedule_cron"] = name
    elif "schedule_cron" not in result:
        pass
    else:
        result["schedule_cron"] = result.get("schedule_cron") or ""

    if "desensitize_mode" in result:
        mode = str(result.get("desensitize_mode") or "mask").strip() or "mask"
        if mode not in DESENSITIZE_MODES:
            raise ApiError(f"不支持的脱敏方式: {mode}", 400)
        result["desensitize_mode"] = mode

    if not partial:
        if not (result.get("webhook_secret") or "").strip():
            import secrets

            result["webhook_secret"] = secrets.token_urlsafe(24)

    write_mode = result.get("write_mode") if "write_mode" in result else (getattr(existing, "write_mode", None) if existing else "")
    target_ref = result.get("target_datasource_id") or (getattr(existing, "target_datasource_id", None) if existing else None)
    if write_mode in ("upsert", "update_only") and target_ref:
        from datasources.connectors.registry import connector_supports_upsert
        from datasources.models import Datasource

        target = Datasource.objects.filter(id=target_ref).first()
        if target and not connector_supports_upsert(target.type):
            raise ApiError("该目标不支持按匹配键更新，请使用「仅插入」", 400)

    return result
