"""增量水位：比较、过滤、以及 HTTP 查询参数。"""
from __future__ import annotations

from datetime import datetime


def _to_dt(v) -> datetime | None:
    """尝试把值解析为 datetime。支持 ISO8601、带/不带时区、日期-only。"""
    if isinstance(v, datetime):
        return v
    if v in (None, ""):
        return None
    try:
        s = str(v).strip().replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def geq(left, right) -> bool:
    """>= 比较。策略同 greater。"""
    if left is None:
        return False
    if right in (None, ""):
        return True
    dt_l = _to_dt(left)
    dt_r = _to_dt(right)
    if dt_l is not None and dt_r is not None:
        if dt_l.tzinfo is None and dt_r.tzinfo is not None:
            dt_r = dt_r.replace(tzinfo=None)
        elif dt_l.tzinfo is not None and dt_r.tzinfo is None:
            dt_l = dt_l.replace(tzinfo=None)
        return dt_l >= dt_r
    try:
        return float(left) >= float(right)
    except (TypeError, ValueError):
        return str(left) >= str(right)


def greater(left, right) -> bool:
    return not geq(right, left)  # left > right iff not (right >= left)


def active(job_cfg: dict | None) -> bool:
    cfg = job_cfg or {}
    if cfg.get("sync_mode") != "incremental":
        return False
    field = (cfg.get("watermark_field") or "").strip()
    value = cfg.get("watermark_value")
    return bool(field) and value not in (None, "")


def field_name(job_cfg: dict | None) -> str:
    return str((job_cfg or {}).get("watermark_field") or "").strip()


def query_params(job_cfg: dict | None) -> dict[str, str]:
    if not active(job_cfg):
        return {}
    cfg = job_cfg or {}
    name = str(cfg.get("watermark_param") or cfg.get("watermark_field") or "").strip()
    if not name:
        return {}
    return {name: str(cfg.get("watermark_value"))}


def filter_rows(rows: list[dict], job_cfg: dict | None) -> list[dict]:
    """本地水位线过滤（>=）。

    注：数据库连接器（SQL/MongoDB/ES）已在查询层用 >= 过滤，
    这里只对没有原生水位线能力的连接器（MQ、SaaS 本地过滤）起作用。
    """
    if not active(job_cfg):
        return rows
    field = field_name(job_cfg)
    threshold = (job_cfg or {}).get("watermark_value")
    return [r for r in rows if isinstance(r, dict) and geq(r.get(field), threshold)]
