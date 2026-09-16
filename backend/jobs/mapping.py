"""
字段映射引擎。

支持直接映射、trim/upper/lower、类型转换、concat/substring/replace、md5/base64、自定义表达式。
规则字段与前端 FieldMappingRule 对齐：source / target / transform / params / required / defaultValue。
"""
from __future__ import annotations

import base64
import hashlib
import re
from datetime import datetime
from typing import Any


VALID_TRANSFORMS = {
    "none", "", "trim", "upper", "lower",
    "toInt", "toFloat", "toString", "toDate", "defaultValue",
    "to_number", "to_string", "to_date",
    "concat", "substring", "replace", "md5", "base64_encode", "base64_decode", "custom",
    "statusMap", "status_map",
}


def get_nested(obj: dict, path: str) -> Any:
    cur: Any = obj
    for key in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def set_nested(obj: dict, path: str, value: Any) -> None:
    keys = path.split(".")
    cur = obj
    for key in keys[:-1]:
        if key not in cur or not isinstance(cur[key], dict):
            cur[key] = {}
        cur = cur[key]
    cur[keys[-1]] = value


def apply_transform(value: Any, transform: str, params: dict | None = None) -> Any:
    params = params or {}
    if transform in ("none", "", None):
        return value
    if transform == "trim":
        return str(value).strip()
    if transform == "upper":
        return str(value).upper()
    if transform == "lower":
        return str(value).lower()
    if transform in ("toInt", "to_int"):
        try:
            return int(float(value))
        except (TypeError, ValueError) as exc:
            raise ValueError(f'无法将 "{value}" 转换为整数') from exc
    if transform in ("toFloat", "to_float", "to_number"):
        try:
            num = float(value)
            return int(num) if num.is_integer() and transform == "to_number" else num
        except (TypeError, ValueError) as exc:
            raise ValueError(f'无法将 "{value}" 转换为数字') from exc
    if transform in ("toString", "to_string"):
        return str(value)
    if transform in ("defaultValue", "default_value"):
        return value
    if transform in ("toDate", "to_date"):
        text = str(value)
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d"):
            try:
                return datetime.strptime(text[:19], fmt).isoformat()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
        except ValueError as exc:
            raise ValueError(f'无法将 "{value}" 转换为日期') from exc
    if transform == "concat":
        return f"{params.get('prefix', '')}{value}{params.get('suffix', '')}"
    if transform == "substring":
        start = int(params.get("start") or 0)
        length = params.get("length")
        text = str(value)
        return text[start: start + int(length)] if length is not None else text[start:]
    if transform == "replace":
        pattern = str(params.get("pattern") or "")
        replacement = str(params.get("replacement") or "")
        if params.get("regex"):
            return re.sub(pattern, replacement, str(value))
        return str(value).replace(pattern, replacement)
    if transform == "md5":
        return hashlib.md5(str(value).encode()).hexdigest()
    if transform == "base64_encode":
        return base64.b64encode(str(value).encode()).decode()
    if transform == "base64_decode":
        return base64.b64decode(str(value)).decode()
    if transform == "custom":
        expression = str(params.get("expression") or "value")
        # 受限沙箱：仅暴露 value
        return eval(expression, {"__builtins__": {}}, {"value": value})  # noqa: S307
    if transform in ("statusMap", "status_map"):
        return map_status_value(value, params.get("rules") or [])
    return value


def values_equal(left: Any, right: Any) -> bool:
    if left is None and right is None:
        return True
    if left is None or right is None:
        return False
    if isinstance(left, bool) or isinstance(right, bool):
        return _as_bool(left) == _as_bool(right) if _boolish(left) and _boolish(right) else left == right
    try:
        return float(left) == float(right)
    except (TypeError, ValueError):
        return str(left) == str(right)


def _boolish(value: Any) -> bool:
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)) and value in (0, 1):
        return True
    if isinstance(value, str) and value.lower() in ("true", "false", "1", "0"):
        return True
    return False


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.lower() in ("true", "1")
    return bool(value)


def map_status_value(value: Any, rules: list) -> Any:
    for rule in rules or []:
        if not isinstance(rule, dict):
            continue
        if values_equal(value, rule.get("from")):
            return rule.get("to")
    return value


def apply_status_mapping(source: dict, dest: dict, mapping: dict | None) -> dict:
    if not isinstance(mapping, dict):
        return dest
    src_field = str(mapping.get("sourceField") or "").strip()
    tgt_field = str(mapping.get("targetField") or "").strip()
    if not src_field or not tgt_field:
        return dest
    raw = get_nested(source, src_field) if "." in src_field else source.get(src_field)
    for rule in mapping.get("rules") or []:
        if isinstance(rule, dict) and values_equal(raw, rule.get("from")):
            dest[tgt_field] = rule.get("to")
            break
    return dest


def transform_record(source: dict, mappings: list[dict], status_mapping: dict | None = None) -> dict:
    result: dict = {}
    for mapping in mappings or []:
        source_field = mapping.get("source") or ""
        target_field = mapping.get("target") or ""
        transform = mapping.get("transform") or "none"
        params = mapping.get("params")
        required = mapping.get("required")
        default_value = mapping.get("defaultValue", mapping.get("default_value"))
        value = get_nested(source, source_field) if "." in source_field else source.get(source_field)
        if value in (None, "") and default_value is not None:
            value = default_value
        if required and value in (None, ""):
            raise ValueError(f"字段 {source_field} 为必填项，但值为空")
        if value is not None:
            value = apply_transform(value, transform, params)
        if "." in target_field:
            set_nested(result, target_field, value)
        else:
            result[target_field] = value
    if status_mapping:
        apply_status_mapping(source, result, status_mapping)
    return result


def transform_batch(records: list[dict], mappings: list[dict], status_mapping: dict | None = None) -> dict:
    success, failed = [], []
    for record in records:
        try:
            success.append(transform_record(record, mappings, status_mapping=status_mapping))
        except Exception as exc:
            failed.append({"record": record, "error": str(exc)})
    return {"success": success, "failed": failed}


def validate_mappings(mappings: list) -> dict:
    errors = []
    if not isinstance(mappings, list):
        return {"valid": False, "errors": ["映射规则必须是数组"]}
    targets = set()
    for i, m in enumerate(mappings):
        prefix = f"第 {i + 1} 条映射"
        if not m.get("source"):
            errors.append(f"{prefix}缺少源字段 source")
        if not m.get("target"):
            errors.append(f"{prefix}缺少目标字段 target")
        target = m.get("target")
        if target and target in targets:
            errors.append(f"{prefix}目标字段 {target} 重复")
        if target:
            targets.add(target)
        t = m.get("transform")
        if t and t not in VALID_TRANSFORMS:
            errors.append(f"{prefix}未知的转换类型: {t}")
        if t == "custom":
            params = m.get("params") or {}
            if not str(params.get("expression") or "").strip():
                errors.append(f"{prefix}自定义表达式缺少 params.expression")
    return {"valid": not errors, "errors": errors}
