"""双向同步防回环：源系统标记 + hops 去重。"""
from __future__ import annotations


DEFAULT_MARKER = "_ip_origin"
DEFAULT_HOPS = "_ip_hops"


def marker_field(job) -> str:
    return (getattr(job, "origin_marker_field", None) or DEFAULT_MARKER).strip() or DEFAULT_MARKER


def origin_id(job) -> str:
    return (getattr(job, "origin_system_id", None) or getattr(job, "code", "") or job.id).strip()


def hops_field() -> str:
    return DEFAULT_HOPS


def is_echo(row: dict, job) -> bool:
    """记录来自本系统（或已经过本系统）则视为回环。"""
    if not isinstance(row, dict):
        return False
    field = marker_field(job)
    oid = origin_id(job)
    marked = row.get(field)
    if marked and str(marked) == oid:
        return True
    hops = row.get(hops_field())
    if isinstance(hops, list) and oid in [str(x) for x in hops]:
        return True
    return False


def stamp(row: dict, job) -> dict:
    out = dict(row)
    field = marker_field(job)
    oid = origin_id(job)
    hops = out.get(hops_field())
    if not isinstance(hops, list):
        hops = [str(hops)] if hops else []
    if oid not in [str(x) for x in hops]:
        hops = [*hops, oid]
    out[hops_field()] = hops
    if field not in out or not out.get(field):
        out[field] = oid
    return out
