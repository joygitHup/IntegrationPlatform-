"""开放接口租户隔离：API Key 看见自己创建的，以及运营指派给该密钥的资源。"""
from __future__ import annotations

from django.db.models import Q

from core.exceptions import ApiError


def partner_id(request) -> str | None:
    ctx = getattr(request, "auth_ctx", None)
    if ctx is not None and getattr(ctx, "client", None) is not None:
        return ctx.user_id
    return None


def partner_q(oid: str) -> Q:
    return Q(created_by=oid) | Q(client_id=oid)


def workspace_q(ws: str, *, partner: bool = False) -> Q:
    """API Key 代配资源可能未绑 Workspace，对 Key 仍可见。控制台 JWT 必须严格按所选过滤。"""
    if partner:
        return Q(workspace_id=ws) | Q(workspace_id="")
    return Q(workspace_id=ws)


def workspace_job_ids(ws: str, *, partner: bool = False):
    from jobs.models import IntegrationJob

    return IntegrationJob.objects.filter(workspace_q(ws, partner=partner)).values_list("id", flat=True)


def scope_qs(qs, request, field: str = "created_by"):
    oid = partner_id(request)
    if oid:
        if hasattr(qs.model, "client_id"):
            qs = qs.filter(partner_q(oid))
        else:
            qs = qs.filter(**{field: oid})
    from open_api.partner import request_workspace_id

    ws = request_workspace_id(request)
    if ws and hasattr(qs.model, "workspace_id"):
        qs = qs.filter(workspace_q(ws, partner=bool(oid)))
    return qs


def assert_owned(obj, request, field: str = "created_by"):
    oid = partner_id(request)
    if not oid:
        return obj
    if getattr(obj, field, "") == oid or getattr(obj, "client_id", "") == oid:
        return obj
    raise ApiError("资源不存在", 404, code="NOT_FOUND")
