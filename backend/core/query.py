"""查询参数兼容 camelCase / snake_case。"""
from __future__ import annotations


def q(request, *names, default=None):
    params = getattr(request, "query_params", None) or request.GET
    for name in names:
        value = params.get(name)
        if value not in (None, ""):
            return value
    return default


def q_int(request, *names, default: int = 0) -> int:
    raw = q(request, *names, default=None)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default
