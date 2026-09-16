"""
数据源连接配置：类型归一、默认值、必填校验、敏感字段占位。

字段名与前端 DynamicConfigForm / ConnectorMetadata.configSchema.fields 对齐：
  name / label / type / required / defaultValue / showWhen / sensitive
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from core.exceptions import ApiError
from datasources.connectors.registry import SENSITIVE_FIELDS, get_connector

# 前端 PasswordInput 以 *** 开头且较长的值视为已脱敏，提交时不覆盖原密码
MASKED_PLACEHOLDER = "***MASKED****************"

TYPE_ALIASES = {
    "postgres": "postgresql",
    "pg": "postgresql",
}


def normalize_type(type_name: str) -> str:
    raw = (type_name or "").strip()
    return TYPE_ALIASES.get(raw, raw)


def require_connector(type_name: str):
    type_name = normalize_type(type_name)
    connector = get_connector(type_name)
    if not connector:
        raise ApiError(f"不支持的数据源类型: {type_name}", 400)
    return type_name, connector


def schema_fields(connector) -> list[dict]:
    return list((connector.config_schema or {}).get("fields") or [])


def sensitive_keys(type_name: str, connector=None) -> list[str]:
    keys = list(SENSITIVE_FIELDS.get(type_name) or [])
    if connector is None:
        connector = get_connector(type_name)
    if connector:
        for field in schema_fields(connector):
            if field.get("sensitive") or field.get("type") == "password":
                name = field.get("name")
                if name and name not in keys:
                    keys.append(name)
    if not keys:
        keys = ["password", "token", "secret", "appSecret"]
    return keys


def is_masked_value(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("***")


def apply_defaults(type_name: str, config: dict | None) -> dict:
    type_name, connector = require_connector(type_name)
    result = deepcopy(config or {})
    for field in schema_fields(connector):
        name = field.get("name")
        if not name:
            continue
        if result.get(name) in (None, "") and field.get("defaultValue") is not None:
            result[name] = field["defaultValue"]
    return result


def _field_visible(field: dict, config: dict) -> bool:
    cond = field.get("showWhen") or field.get("show_when")
    if not cond:
        return True
    return str(config.get(cond.get("field"))) == str(cond.get("value"))


def validate_config(type_name: str, config: dict, *, allow_masked: bool = False) -> dict:
    """校验必填项，返回字段级错误 { fieldName: message }，与前端 formErrors 对齐。"""
    type_name, connector = require_connector(type_name)
    errors: dict[str, str] = {}
    for field in schema_fields(connector):
        if not field.get("required") or not _field_visible(field, config):
            continue
        name = field["name"]
        value = config.get(name)
        if allow_masked and is_masked_value(value):
            continue
        if value in (None, ""):
            errors[name] = f"{field.get('label') or name}不能为空"
    return errors


def merge_secrets(type_name: str, incoming: dict, stored: dict) -> dict:
    """编辑/测试时用库中明文覆盖脱敏占位，避免把 *** 写回或拿去探测。"""
    type_name, connector = require_connector(type_name)
    result = deepcopy(incoming or {})
    for key in sensitive_keys(type_name, connector):
        if is_masked_value(result.get(key)) or result.get(key) in (None, ""):
            if stored.get(key) not in (None, ""):
                result[key] = stored[key]
    return result


def mask_config_for_api(type_name: str, config: dict) -> dict:
    try:
        type_name, connector = require_connector(type_name)
    except ApiError:
        result = deepcopy(config or {})
        for key, value in list(result.items()):
            if value and str(key).lower() in {"password", "token", "secret", "appsecret"}:
                result[key] = MASKED_PLACEHOLDER
        return result
    result = deepcopy(config or {})
    for key in sensitive_keys(type_name, connector):
        if result.get(key) not in (None, ""):
            result[key] = MASKED_PLACEHOLDER
    return result
