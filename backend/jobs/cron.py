"""Cron 表达式：5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周）。

支持 *、*/n、a-b、a-b/n、逗号列表、月份/星期英文名（JAN–DEC、SUN–SAT）。
日与周都限制时按 Vixie：任一匹配即触发。
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
DOWS = {
    "sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6,
}

_RANGES = (
    (0, 59),   # second
    (0, 59),   # minute
    (0, 23),   # hour
    (1, 31),   # day
    (1, 12),   # month
    (0, 7),    # dow (0 and 7 = Sunday)
)


class CronError(ValueError):
    pass


def split_expr(expr: str) -> list[str]:
    parts = [p for p in str(expr or "").strip().split() if p]
    if len(parts) not in (5, 6):
        raise CronError("Cron 表达式应为 5 或 6 段")
    if len(parts) == 5:
        parts = ["*"] + parts
    return parts


def parse(expr: str) -> tuple[set[int], set[int], set[int], set[int], set[int], set[int]]:
    parts = split_expr(expr)
    names = [None, None, None, None, MONTHS, DOWS]
    expanded = []
    for i, field in enumerate(parts):
        lo, hi = _RANGES[i]
        values = expand_field(field, lo, hi, names[i])
        if not values:
            raise CronError(f"Cron 字段无效: {field}")
        expanded.append(values)
    return tuple(expanded)  # type: ignore[return-value]


def valid_cron(expr: str) -> bool:
    try:
        parse(expr)
        return True
    except (CronError, ValueError):
        return False


def cron_matches(expr: str, when: datetime | None = None) -> bool:
    now = when or datetime.now(TZ)
    if now.tzinfo is None:
        now = now.replace(tzinfo=TZ)
    else:
        now = now.astimezone(TZ)
    try:
        _sec, minutes, hours, days, months, dows = parse(expr)
    except (CronError, ValueError):
        return False
    if now.minute not in minutes or now.hour not in hours or now.month not in months:
        return False
    cron_dow = (now.weekday() + 1) % 7
    dow_ok = cron_dow in dows or (cron_dow == 0 and 7 in dows)
    day_ok = now.day in days
    parts = split_expr(expr)
    day_star = _is_star(parts[3])
    dow_star = _is_star(parts[5])
    if day_star and dow_star:
        return True
    if day_star:
        return dow_ok
    if dow_star:
        return day_ok
    return day_ok or dow_ok


def expand_field(field: str, minimum: int, maximum: int, names: dict[str, int] | None) -> set[int]:
    out: set[int] = set()
    for atom in str(field).split(","):
        piece = atom.strip()
        if not piece:
            raise CronError("Cron 字段含空项")
        out.update(_expand_atom(piece, minimum, maximum, names))
    return out


def _is_star(field: str) -> bool:
    return str(field).strip() == "*"


def _token(text: str, names: dict[str, int] | None) -> int:
    raw = text.strip()
    if names:
        key = raw.lower()
        if key in names:
            return names[key]
    if not raw.lstrip("-").isdigit():
        raise CronError(f"Cron 无法解析: {text}")
    return int(raw)


def _expand_atom(atom: str, minimum: int, maximum: int, names: dict[str, int] | None) -> Iterable[int]:
    step = 1
    body = atom
    if "/" in atom:
        body, step_s = atom.split("/", 1)
        if not step_s.isdigit() or int(step_s) < 1:
            raise CronError(f"Cron 步长无效: {atom}")
        step = int(step_s)
        if not body:
            body = "*"
    if body == "*":
        start, end = minimum, maximum
    elif "-" in body:
        left, right = body.split("-", 1)
        start, end = _token(left, names), _token(right, names)
    else:
        value = _token(body, names)
        if step != 1 and "/" in atom and "-" not in body:
            start, end = value, maximum
        else:
            start = end = value
            step = 1
    if start > end:
        raise CronError(f"Cron 范围反转: {atom}")
    values = [n for n in range(start, end + 1, step) if minimum <= n <= maximum]
    if not values:
        raise CronError(f"Cron 取值越界: {atom}")
    return values
