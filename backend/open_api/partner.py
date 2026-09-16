"""集成商 Workspace（最终客户）与创建时的默认上下文。"""
from __future__ import annotations

import re

from core.exceptions import ApiError
from core.env import request_environment

WORKSPACE_CODE_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")


def request_workspace_id(request) -> str:
    header = (request.META.get("HTTP_X_WORKSPACE_ID") or "").strip()
    query = ""
    try:
        query = (request.GET.get("workspaceId") or request.GET.get("workspace_id") or "").strip()
    except Exception:
        pass
    body = ""
    data = getattr(request, "data", None)
    if isinstance(data, dict):
        body = str(data.get("workspaceId") or data.get("workspace_id") or "").strip()
    return header or query or body


def ensure_default_workspace(client) -> "object":
    from open_api.models import PartnerWorkspace

    ws = PartnerWorkspace.objects.filter(client_id=client.id, code="default").first()
    if ws:
        return ws
    ws = PartnerWorkspace(
        client_id=client.id,
        name=f"{client.name} 默认客户",
        code="default",
        status="active",
        environment="dev" if getattr(client, "sandbox", False) else "",
    )
    ws.save()
    return ws


def ensure_platform_workspace() -> "object":
    """控制台运营侧的默认 Workspace，不绑集成商凭证。"""
    from open_api.models import PartnerWorkspace

    ws = PartnerWorkspace.objects.filter(client_id="", code="default").first()
    if ws:
        return ws
    ws = PartnerWorkspace(
        client_id="",
        name="默认 Workspace",
        code="default",
        status="active",
        environment="",
    )
    ws.save()
    return ws


def resolve_workspace(ws_id: str, *, client_id: str | None = None) -> "object":
    from open_api.models import PartnerWorkspace

    qs = PartnerWorkspace.objects.filter(id=ws_id)
    if client_id:
        qs = qs.filter(client_id=client_id)
    ws = qs.first()
    if not ws:
        raise ApiError("Workspace 不存在", 404, code="NOT_FOUND")
    return ws


def create_workspace(*, name: str, code: str, client_id: str = "", environment: str = "", status: str = "active"):
    from open_api.models import PartnerWorkspace

    name = (name or "").strip()
    code = (code or "").strip()
    if not name or not code:
        raise ApiError("请填写名称和编码", 400, code="VALIDATION")
    if not WORKSPACE_CODE_RE.match(code):
        raise ApiError("编码只能以字母开头，可包含字母、数字、下划线和中划线", 400, code="VALIDATION")
    if PartnerWorkspace.objects.filter(client_id=client_id, code=code).exists():
        raise ApiError("编码已存在", 400, code="VALIDATION")
    ws = PartnerWorkspace(
        client_id=client_id or "",
        name=name,
        code=code,
        environment=environment or "",
        status=status or "active",
    )
    ws.save()
    return ws


def apply_create_context(request, data: dict) -> dict:
    result = dict(data)
    from core.tenancy import resolve_create_client_id

    # 客户归属只信服务端主体：API Key / 客户账号强制回本客户，平台可指派已存在客户
    cid = resolve_create_client_id(request, result)
    result["client_id"] = cid
    api_key_client = getattr(getattr(request, "auth_ctx", None), "client", None)
    ws_id = request_workspace_id(request) or result.get("workspace_id") or result.get("workspaceId") or ""
    if api_key_client:
        if not ws_id:
            ws_id = ensure_default_workspace(api_key_client).id
        else:
            resolve_workspace(ws_id, client_id=api_key_client.id)
    elif cid and ws_id:
        # 客户账号引用的 Workspace 必须属于本客户
        resolve_workspace(ws_id, client_id=cid)
    elif ws_id:
        resolve_workspace(ws_id)
    if ws_id:
        result["workspace_id"] = ws_id
    if cid:
        from open_api.models import IntegrationClient

        owner = IntegrationClient.objects.filter(id=cid).first()
        if owner is not None and getattr(owner, "sandbox", False):
            env = (result.get("environment") or request_environment(request) or "").lower()
            if env == "prod":
                raise ApiError("沙箱客户不能创建生产环境资源", 403, code="SANDBOX_ENV")
            result["environment"] = result.get("environment") or "dev"
    return result


def serialize_workspace(ws) -> dict:
    return {
        "id": ws.id,
        "clientId": ws.client_id,
        "name": ws.name,
        "code": ws.code,
        "status": ws.status,
        "environment": ws.environment,
        "createdAt": ws.created_at.isoformat() if ws.created_at else None,
    }
