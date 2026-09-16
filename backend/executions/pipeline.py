"""
脱敏、指纹、同步决策。
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from core.encryption import mask_sensitive


DESENSITIZE_MODES = (
    "mask",
    "hash",
    "remove",
    "phone",
    "email",
    "id_card",
    "bank_card",
    "name",
    "address",
    "keep_last4",
    "auto",
)

_NAME_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|密码", re.I), "remove"),
    (re.compile(r"mobile|phone|tel|cellphone|手机|电话", re.I), "phone"),
    (re.compile(r"email|mailbox|邮箱|邮件", re.I), "email"),
    (re.compile(r"id[_-]?card|idcard|identity|idno|sfz|身份证", re.I), "id_card"),
    (re.compile(r"bank[_-]?card|card[_-]?no|bankno|credit|银行卡|卡号", re.I), "bank_card"),
    (re.compile(r"address|addr|地址", re.I), "address"),
    (re.compile(r"(real[_-]?name|full[_-]?name|display[_-]?name|xingming|^name$|姓名|名字)", re.I), "name"),
    (re.compile(r"salary|income|wage|薪资|工资", re.I), "mask"),
)


def infer_rule(field: str, value: Any) -> str | None:
    name = str(field or "")
    for pattern, rule in _NAME_RULES:
        if pattern.search(name):
            return rule
    text = "" if value is None else str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", text):
        return "email"
    if re.fullmatch(r"1\d{10}", text):
        return "phone"
    if re.fullmatch(r"\d{17}[\dXx]", text):
        return "id_card"
    if re.fullmatch(r"\d{16,19}", text):
        return "bank_card"
    return None


def detect_sensitive_fields(record: dict | None) -> list[str]:
    found: list[str] = []
    for key, value in (record or {}).items():
        if infer_rule(str(key), value):
            found.append(str(key))
    return found


def resolve_sensitive_fields(record: dict | None, configured: list | None) -> list[str]:
    seen: list[str] = []
    for field in list(configured or []) + detect_sensitive_fields(record):
        name = str(field or "").strip()
        if name and name not in seen:
            seen.append(name)
    return seen


def apply_rule(text: str, mode: str) -> str:
    value = text or ""
    if mode == "hash":
        return hashlib.sha256(value.encode()).hexdigest()[:16]
    if mode == "phone":
        digits = re.sub(r"\D", "", value)
        if len(digits) >= 7:
            return digits[:3] + "****" + digits[-4:]
        return mask_sensitive(value)
    if mode == "email":
        if "@" in value:
            local, _, domain = value.partition("@")
            head = local[:1] if local else "*"
            return f"{head}***@{domain}"
        return mask_sensitive(value)
    if mode == "id_card":
        if len(value) >= 8:
            return value[:3] + ("*" * (len(value) - 7)) + value[-4:]
        return mask_sensitive(value)
    if mode in ("bank_card", "keep_last4"):
        if len(value) >= 4:
            return "*" * max(len(value) - 4, 4) + value[-4:]
        return "****"
    if mode == "name":
        if len(value) <= 1:
            return "*"
        return value[0] + ("*" * (len(value) - 1))
    if mode == "address":
        keep = min(6, max(len(value) // 2, 1))
        return value[:keep] + "****"
    return mask_sensitive(value)


def desensitize_record(record: dict, fields: list[str], mode: str = "mask") -> dict:
    result = dict(record)
    rule = (mode or "mask").strip() or "mask"
    if rule not in DESENSITIZE_MODES:
        rule = "mask"
    for field in fields or []:
        if field not in result:
            continue
        value = result[field]
        if value is None:
            continue
        chosen = infer_rule(field, value) or "mask" if rule == "auto" else rule
        if chosen == "remove":
            result.pop(field, None)
        else:
            result[field] = apply_rule(str(value), chosen)
    return result


_FINGERPRINT_SKIP = {"_ip_origin", "_ip_hops"}


def jsonable(value: Any) -> Any:
    """把 Decimal / datetime 等转成 JSONField 与 Celery 可序列化的值。"""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def fingerprint(record: dict) -> str:
    text = "|".join(f"{k}={record.get(k)}" for k in sorted(record.keys()))
    return hashlib.sha256(text.encode()).hexdigest()


def conflict_fingerprint(record: dict) -> str:
    text = "|".join(
        f"{k}={record.get(k)}"
        for k in sorted(record.keys())
        if k not in _FINGERPRINT_SKIP
    )
    return hashlib.sha256(text.encode()).hexdigest()


def _newer(left, right) -> bool:
    if left is None:
        return False
    if right in (None, ""):
        return True
    try:
        return float(left) >= float(right)
    except (TypeError, ValueError):
        return str(left) >= str(right)


def make_sync_decision(
    *,
    existing: dict | None,
    incoming: dict,
    strategy: str = "source_wins",
    compare_field: str = "",
) -> str:
    """
    返回 create / update / skip / conflict。
    source_wins: 覆盖目标；target_wins: 保留目标；newest_wins: 比较时间；manual: 冲突人工处理。
    """
    if existing is None:
        return "create"
    if strategy == "source_wins":
        return "update"
    if strategy == "target_wins":
        return "skip"
    if strategy == "newest_wins":
        field = (compare_field or "").strip()
        if field:
            return "update" if _newer(incoming.get(field), existing.get(field)) else "skip"
        return "update" if conflict_fingerprint(incoming) >= conflict_fingerprint(existing) else "skip"
    if strategy == "manual":
        return "conflict"
    return "update"
