"""集成商用量计量与月配额。"""
from __future__ import annotations

from datetime import date

from django.db.models import Sum


def _today() -> date:
    return date.today()


def _month_start() -> date:
    today = _today()
    return today.replace(day=1)


def bump(client_id: str, *, api_calls: int = 0, rows_written: int = 0) -> None:
    if not client_id or (not api_calls and not rows_written):
        return
    from open_api.models import ClientUsageDaily

    day = _today()
    row, _ = ClientUsageDaily.objects.get_or_create(
        client_id=client_id,
        day=day,
        defaults={"api_calls": 0, "rows_written": 0},
    )
    if api_calls:
        ClientUsageDaily.objects.filter(id=row.id).update(api_calls=row.api_calls + api_calls)
    if rows_written:
        fresh = ClientUsageDaily.objects.filter(id=row.id).first()
        if fresh:
            ClientUsageDaily.objects.filter(id=row.id).update(rows_written=fresh.rows_written + rows_written)


def month_totals(client_id: str) -> dict:
    from open_api.models import ClientUsageDaily

    agg = ClientUsageDaily.objects.filter(client_id=client_id, day__gte=_month_start()).aggregate(
        api_calls=Sum("api_calls"),
        rows_written=Sum("rows_written"),
    )
    return {
        "apiCalls": int(agg.get("api_calls") or 0),
        "rowsWritten": int(agg.get("rows_written") or 0),
    }


def today_totals(client_id: str) -> dict:
    from open_api.models import ClientUsageDaily

    row = ClientUsageDaily.objects.filter(client_id=client_id, day=_today()).first()
    return {
        "apiCalls": int(getattr(row, "api_calls", 0) or 0),
        "rowsWritten": int(getattr(row, "rows_written", 0) or 0),
    }


def assert_quota(client) -> None:
    """兼容旧调用：月度调用门禁统一走授权表（SaaS 拒绝 / 私有化告警）。"""
    if client is None:
        return
    from open_api.entitlements import gate_api_calls

    gate_api_calls(client.id)


def usage_payload(client) -> dict:
    from open_api.entitlements import entitlement_payload

    month = month_totals(client.id)
    today = today_totals(client.id)
    return {
        "today": today,
        "month": month,
        "quotas": {
            "rateLimitPerMinute": client.rate_limit_per_minute,
            "monthlyCallQuota": client.monthly_call_quota,
            "monthlyRowQuota": client.monthly_row_quota,
        },
        "entitlements": entitlement_payload(client.id),
        "sandbox": bool(client.sandbox),
    }
