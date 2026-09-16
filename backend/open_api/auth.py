"""API Key 认证，挂载与 JWT 兼容的 auth_ctx。含 IP 白名单与按客户端限流。"""
from __future__ import annotations

import hashlib
import ipaddress
import secrets
from dataclasses import dataclass, field
from typing import Any

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from core.exceptions import ApiError
from core.ids import generate_trace_id
from core.permissions import has_permission
from core.throttling import check_client_rate_limit
from open_api.models import IntegrationClient


def generate_api_key() -> str:
    return "ipk_" + secrets.token_urlsafe(32)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def request_ip(request) -> str:
    return (
        (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
        or request.META.get("REMOTE_ADDR")
        or ""
    )


def ip_allowed(ip: str, whitelist) -> bool:
    rules = [str(x).strip() for x in (whitelist or []) if str(x).strip()]
    if not rules:
        return True
    raw = (ip or "").strip()
    if not raw:
        return False
    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        return raw in rules
    for rule in rules:
        try:
            if "/" in rule:
                if addr in ipaddress.ip_network(rule, strict=False):
                    return True
            elif ipaddress.ip_address(rule) == addr:
                return True
        except ValueError:
            if rule == raw or (rule.endswith(".") and raw.startswith(rule)):
                return True
    return False


@dataclass
class PartnerContext:
    user_id: str
    username: str
    role_id: str = ""
    role_code: str = "integrator"
    email: str | None = None
    display_name: str | None = None
    permissions: list[str] = field(default_factory=list)
    ip: str = ""
    user_agent: str = ""
    trace_id: str = ""
    user: Any = None
    client: Any = None

    @property
    def userId(self) -> str:  # noqa: N802
        return self.user_id

    @property
    def roleId(self) -> str:  # noqa: N802
        return self.role_id


def extract_api_key(request) -> str | None:
    header = request.META.get("HTTP_X_API_KEY") or request.META.get("HTTP_API_KEY")
    if header:
        return header.strip()
    auth = request.META.get("HTTP_AUTHORIZATION") or ""
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        if token.startswith("ipk_"):
            return token
    return None


class ApiKeyAuthentication(BaseAuthentication):
    def authenticate(self, request):
        raw = extract_api_key(request)
        if not raw:
            return None
        digest = hash_api_key(raw)
        client = IntegrationClient.objects.filter(key_hash=digest, status="active").first()
        if not client:
            raise AuthenticationFailed("无效的 API Key")
        ip = request_ip(request)
        if not ip_allowed(ip, client.ip_whitelist):
            raise ApiError("IP 不在白名单内", 403, code="IP_DENIED")
        from open_api.entitlements import gate_api_calls

        gate_api_calls(client.id)
        allowed, wait_ms = check_client_rate_limit(client.id, client.rate_limit_per_minute or 0)
        if not allowed:
            raise ApiError("请求过于频繁，请稍后再试", 429, code="RATE_LIMITED")
        IntegrationClient.objects.filter(id=client.id).update(last_used_at=timezone.now())
        scopes = list(client.scopes or [])
        ctx = PartnerContext(
            user_id=client.id,
            username=client.code,
            display_name=client.name,
            permissions=scopes if scopes else ["*"],
            ip=ip,
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
            trace_id=request.META.get("HTTP_X_TRACE_ID") or generate_trace_id(),
            client=client,
        )
        request.auth_ctx = ctx
        # 同步到底层 Django request，供 RequestContextMiddleware 计量打点
        request._request.auth_ctx = ctx
        return (client, ctx)

    def authenticate_header(self, request):
        return "Bearer"


def require_scope(request, *scopes: str) -> None:
    ctx = getattr(request, "auth_ctx", None)
    if not ctx:
        raise ApiError("Unauthorized", 401)
    if any(has_permission(ctx, s) for s in scopes):
        return
    perms = getattr(ctx, "permissions", []) or []
    if "*" in perms:
        return
    raise ApiError("权限不足", 403)
