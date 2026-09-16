"""
Bearer JWT 认证。

成功后在 request.auth_ctx 挂载与前端 authenticate() 一致的上下文字段：
  userId / username / roleId / permissions / ip / userAgent / traceId
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from core.ids import generate_trace_id
from core.jwt import verify_token


@dataclass
class AuthContext:
    user_id: str
    username: str
    role_id: str = ""
    role_code: str = ""
    email: str | None = None
    display_name: str | None = None
    permissions: list[str] = field(default_factory=list)
    ip: str = ""
    user_agent: str = ""
    trace_id: str = ""
    user: Any = None
    client_id: str = ""

    # 兼容前端 camelCase 读取（Python 侧也可用属性）
    @property
    def userId(self) -> str:  # noqa: N802
        return self.user_id

    @property
    def roleId(self) -> str:  # noqa: N802
        return self.role_id


class JWTAuthentication(BaseAuthentication):
    """从 Authorization: Bearer <token> 解析 access token。"""

    def authenticate(self, request):
        header = request.META.get("HTTP_AUTHORIZATION") or ""
        token = None
        if header.startswith("Bearer "):
            token = header[7:].strip()
        if not token:
            token = request.COOKIES.get("access_token")
        if not token:
            return None
        if token.startswith("ipk_"):
            return None

        payload = verify_token(token)
        if not payload or payload.get("type") != "access":
            raise AuthenticationFailed("Unauthorized")

        from iam.models import User
        from iam.services import load_permissions  # 与 MeView / 登录响应共用权限码

        try:
            user = User.objects.get(id=payload.get("userId"))
        except User.DoesNotExist:
            raise AuthenticationFailed("Unauthorized")

        if user.status != "active":
            raise AuthenticationFailed("账号已被禁用")

        role, permissions = load_permissions(user.role_id)
        role_code = role.code if role else ""
        ip = (
            request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("HTTP_X_REAL_IP")
            or request.META.get("REMOTE_ADDR")
            or "unknown"
        )
        ctx = AuthContext(
            user_id=user.id,
            username=user.username,
            role_id=user.role_id or "",
            role_code=role_code,
            email=user.email,
            display_name=user.display_name,
            permissions=permissions,
            ip=ip,
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
            trace_id=request.META.get("HTTP_X_TRACE_ID") or generate_trace_id(),
            user=user,
            client_id=getattr(user, "client_id", "") or "",
        )
        request.auth_ctx = ctx
        # 中间件持有的是底层 Django request，需同步挂载供计量打点使用
        request._request.auth_ctx = ctx
        if user.client_id:
            # 客户账号受月度调用次数门禁（SaaS 拒绝 / 私有化告警放行）
            from open_api.entitlements import gate_api_calls

            gate_api_calls(user.client_id)
        return (user, ctx)

    def authenticate_header(self, request):
        # 让未认证请求返回 401 而非 403，前端据此跳转登录页
        return "Bearer"
