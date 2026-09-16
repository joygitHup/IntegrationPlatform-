"""审计写入，供各模块调用。"""
from __future__ import annotations

from typing import Any

from audit.models import AuditLog


def record_audit_log(
    *,
    user_id: str = "",
    username: str = "",
    client_id: str = "",
    action: str,
    resource_type: str = "",
    resource_id: str = "",
    resource_name: str = "",
    detail: dict[str, Any] | None = None,
    ip: str = "",
    user_agent: str = "",
    trace_id: str = "",
) -> AuditLog:
    return AuditLog.objects.create(
        user_id=user_id or "",
        username=username or "",
        client_id=client_id or "",
        action=action,
        resource_type=resource_type or "",
        resource_id=resource_id or "",
        resource_name=resource_name or "",
        detail=detail,
        ip=ip or "",
        user_agent=user_agent or "",
        trace_id=trace_id or "",
    )


def audit_from_request(request, **kwargs):
    ctx = getattr(request, "auth_ctx", None)
    client_id = ""
    if ctx is not None:
        client = getattr(ctx, "client", None)
        if client is not None:
            client_id = getattr(client, "id", "") or ""
        elif getattr(ctx, "user", None) is not None:
            client_id = getattr(ctx.user, "client_id", "") or ""
        else:
            client_id = getattr(ctx, "client_id", "") or ""
    return record_audit_log(
        user_id=getattr(ctx, "user_id", "") if ctx else "",
        username=getattr(ctx, "username", "") if ctx else "",
        client_id=client_id,
        ip=getattr(ctx, "ip", "") if ctx else "",
        user_agent=getattr(ctx, "user_agent", "") if ctx else "",
        trace_id=getattr(ctx, "trace_id", "") if ctx else "",
        **kwargs,
    )
