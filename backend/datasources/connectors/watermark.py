"""增量水位：比较、过滤、以及 HTTP 查询参数。"""
from __future__ import annotations


def greater(left, right) -> bool:
    if left is None:
        return False
    if right in (None, ""):
        return True
    try:
        return float(left) > float(right)
    except (TypeError, ValueError):
        return str(left) > str(right)


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
    if not active(job_cfg):
        return rows
    field = field_name(job_cfg)
    threshold = (job_cfg or {}).get("watermark_value")
    return [r for r in rows if isinstance(r, dict) and greater(r.get(field), threshold)]
