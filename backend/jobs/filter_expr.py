"""任务过滤条件：AND/OR 链式 field OP value，以及 JSON 等值对象。"""
from __future__ import annotations

import json
import re
from typing import Any

IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PATH_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")
SPLIT_RE = re.compile(r"\s+(AND|OR)\s+", re.IGNORECASE)
TERM_RE = re.compile(
    r"^([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|<>|!=|=|<|>|LIKE)\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)


class FilterError(ValueError):
    pass


def parse(expr: str | None) -> dict | None:
    text = (expr or "").strip()
    if not text:
        return None
    if text.startswith("{"):
        return _parse_json(text)
    parts = SPLIT_RE.split(text)
    if not parts or not str(parts[0]).strip():
        raise FilterError("过滤条件为空")
    return _combine(parts)


def apply_filter(rows: list[dict], expr: str | None) -> list[dict]:
    parsed = parse(expr)
    if parsed is None:
        return rows
    return [r for r in rows if isinstance(r, dict) and match_row(r, parsed)]


def match_row(row: dict, node: dict) -> bool:
    op = node.get("op")
    if op == "and":
        return all(match_row(row, item) for item in node.get("items") or [])
    if op == "or":
        return any(match_row(row, item) for item in node.get("items") or [])
    if op == "cmp":
        return _compare(_get_field(row, str(node.get("field") or "")), str(node.get("cmp") or "="), node.get("value"))
    return False


def to_sql(node: dict, quote_ident, dialect: str) -> tuple[str, list[Any]] | None:
    """可下推时返回 (sql, params)；嵌套路径等无法安全引用时返回 None。"""
    op = node.get("op")
    if op in ("and", "or"):
        parts: list[str] = []
        params: list[Any] = []
        for item in node.get("items") or []:
            frag = to_sql(item, quote_ident, dialect)
            if frag is None:
                return None
            parts.append(frag[0])
            params.extend(frag[1])
        if not parts:
            return None
        joiner = f" {op.upper()} "
        wrapped = parts[0] if len(parts) == 1 else "(" + joiner.join(parts) + ")"
        return wrapped, params
    if op != "cmp":
        return None
    field = str(node.get("field") or "")
    parts = [p for p in field.split(".") if p]
    if not parts or not all(IDENT_RE.match(p) for p in parts):
        return None
    try:
        qfield = quote_ident(field, dialect)
    except ValueError:
        return None
    cmp = str(node.get("cmp") or "=").upper()
    value = node.get("value")
    if value is None:
        if cmp in ("=",):
            return f"{qfield} IS NULL", []
        if cmp in ("!=", "<>"):
            return f"{qfield} IS NOT NULL", []
        return None
    if cmp == "!=":
        cmp = "<>"
    if cmp == "LIKE":
        sql_op = "LIKE"
    elif cmp in ("=", "<>", "<", ">", "<=", ">="):
        sql_op = cmp
    else:
        return None
    return f"{qfield} {sql_op} %s", [value]


def _parse_json(text: str) -> dict:
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        raise FilterError("过滤条件 JSON 无效") from exc
    if not isinstance(obj, dict):
        raise FilterError("过滤条件 JSON 须为对象")
    items = []
    for key, value in obj.items():
        if not PATH_RE.match(str(key)):
            raise FilterError(f"非法字段名: {key}")
        items.append({"op": "cmp", "field": str(key), "cmp": "=", "value": value})
    if not items:
        return None  # type: ignore[return-value]
    return items[0] if len(items) == 1 else {"op": "and", "items": items}


def _combine(parts: list[str]) -> dict:
    terms: list[dict] = [_parse_term(parts[0])]
    ops: list[str] = []
    i = 1
    while i < len(parts):
        ops.append(str(parts[i]).upper())
        if i + 1 >= len(parts):
            raise FilterError("过滤条件不完整")
        terms.append(_parse_term(parts[i + 1]))
        i += 2
    groups: list[list[dict]] = [[terms[0]]]
    for idx, op in enumerate(ops):
        if op == "AND":
            groups[-1].append(terms[idx + 1])
        elif op == "OR":
            groups.append([terms[idx + 1]])
        else:
            raise FilterError(f"不支持的逻辑运算符: {op}")
    or_items = [_and_node(g) for g in groups]
    return or_items[0] if len(or_items) == 1 else {"op": "or", "items": or_items}


def _and_node(items: list[dict]) -> dict:
    return items[0] if len(items) == 1 else {"op": "and", "items": items}


def _parse_term(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        raise FilterError("过滤条件缺少比较式")
    m = TERM_RE.match(raw)
    if not m:
        raise FilterError(f"无法解析过滤条件: {raw}")
    field, cmp, value_text = m.group(1), m.group(2), m.group(3).strip()
    if not PATH_RE.match(field):
        raise FilterError(f"非法字段名: {field}")
    return {"op": "cmp", "field": field, "cmp": cmp.upper() if cmp.upper() == "LIKE" else cmp, "value": _parse_value(value_text)}


def _parse_value(text: str) -> Any:
    if not text:
        raise FilterError("缺少比较值")
    if text[0] in "'\"":
        quote = text[0]
        if len(text) < 2 or text[-1] != quote:
            raise FilterError("字符串未闭合")
        inner = text[1:-1]
        return inner.replace("\\" + quote, quote).replace("\\\\", "\\")
    low = text.lower()
    if low == "null":
        return None
    if low == "true":
        return True
    if low == "false":
        return False
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        return float(text)
    if PATH_RE.match(text):
        return text
    raise FilterError(f"无法解析值: {text}")


def _get_field(row: dict, field: str) -> Any:
    if not field:
        return None
    if "." not in field:
        return row.get(field)
    cur: Any = row
    for key in field.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def _compare(left: Any, op: str, right: Any) -> bool:
    cmp = (op or "=").upper()
    if cmp == "LIKE":
        return _like(left, right)
    if right is None:
        if cmp in ("=",):
            return left is None
        if cmp in ("!=", "<>"):
            return left is not None
        return False
    if left is None:
        return False
    if cmp in ("=",):
        return _equal(left, right)
    if cmp in ("!=", "<>"):
        return not _equal(left, right)
    lv, rv, ok = _ordered(left, right)
    if not ok:
        lv, rv = str(left), str(right)
    if cmp == ">":
        return lv > rv
    if cmp == "<":
        return lv < rv
    if cmp == ">=":
        return lv >= rv
    if cmp == "<=":
        return lv <= rv
    raise FilterError(f"不支持的比较符: {op}")


def _equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        if _boolish(left) and _boolish(right):
            return _as_bool(left) == _as_bool(right)
        return left == right
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


def _ordered(left: Any, right: Any) -> tuple[Any, Any, bool]:
    try:
        return float(left), float(right), True
    except (TypeError, ValueError):
        return str(left), str(right), False


def _like(value: Any, pattern: Any) -> bool:
    if value is None or pattern is None:
        return False
    rx = "^" + "".join(
        ".*" if ch == "%" else "." if ch == "_" else re.escape(ch)
        for ch in str(pattern)
    ) + "$"
    return re.search(rx, str(value), re.IGNORECASE) is not None
