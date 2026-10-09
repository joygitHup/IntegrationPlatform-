"""
RBAC 权限。

权限码与种子数据对齐，例如 user:read / job:execute / datasource:write。
admin 角色或 permissions 含 * 视为全部通过。
"""
from __future__ import annotations

from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission


class IsAuthenticated(BasePermission):
    """无 Token 返回 401，与前端 api-client 跳转登录逻辑对齐。"""

    message = "Unauthorized"

    def has_permission(self, request, view) -> bool:
        if not getattr(request, "auth_ctx", None) and not request.auth:
            raise AuthenticationFailed("Unauthorized")
        return True


# 同一能力在种子数据中可能有两套权限码
PERM_ALIASES = {
    "dlq:read": ("deadletter:read",),
    "dlq:reprocess": ("deadletter:retry", "deadletter:delete"),
    "deadletter:read": ("dlq:read",),
    "deadletter:retry": ("dlq:reprocess",),
    "deadletter:delete": ("dlq:reprocess",),
    "app:write": ("application:write",),
    "app:delete": ("application:delete",),
    "application:write": ("app:write",),
    "application:delete": ("app:delete",),
    "user:delete": ("user:write",),
    "open:manage": ("system:write",),
    "open:read": ("open:manage", "system:read", "system:write"),
}


def has_permission(auth, permission: str) -> bool:
    if not auth:
        return False
    perms = getattr(auth, "permissions", []) or []
    if "*" in perms or permission in perms:
        return True
    for alias in PERM_ALIASES.get(permission, ()):
        if alias in perms:
            return True
    if getattr(auth, "role_code", "") == "admin":
        return True
    # 兼容 permission:resource 存储格式
    for p in perms:
        if p == permission or p.startswith(f"{permission}:"):
            return True
        left, _, right = p.partition(":")
        req_left, _, req_right = permission.partition(":")
        if left == req_left and (right in ("*", "") or right == req_right or req_right == ""):
            return True
        # p 可能是 "datasource:write:*"
        parts = p.split(":")
        if len(parts) >= 2 and f"{parts[0]}:{parts[1]}" == permission:
            return True
    return False


class HasPermission(BasePermission):
    """在视图上声明 required_permission = 'job:read'。"""

    message = "权限不足"

    def has_permission(self, request, view) -> bool:
        perm = getattr(view, "required_permission", None)
        if request.method in ("GET", "HEAD", "OPTIONS"):
            perm = getattr(view, "required_read_permission", None) or perm
        elif request.method == "DELETE":
            perm = (
                getattr(view, "required_delete_permission", None)
                or getattr(view, "required_write_permission", None)
                or perm
            )
        else:
            perm = getattr(view, "required_write_permission", None) or perm
        if not perm:
            return bool(request.user and getattr(request.user, "is_authenticated", True) and request.auth)
        auth = getattr(request, "auth_ctx", None) or request.auth
        return has_permission(auth, perm)
