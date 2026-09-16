"""IAM 认证与用户服务。"""
from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from core.exceptions import ApiError
from core.password import hash_password, validate_password, verify_password
from iam.models import Role, RolePermission, User


def get_user_by_username(username: str) -> User | None:
    return User.objects.filter(username=username).first()


def list_users(
    *,
    page: int,
    page_size: int,
    keyword: str | None,
    role_id: str | None,
    status: str | None,
    client_scope: str | None = None,
):
    """client_scope=None 不按客户过滤（平台账号）；传入客户 id 时只返回该客户的席位。"""
    qs = User.objects.all().order_by("-created_at")
    if client_scope is not None:
        qs = qs.filter(client_id=client_scope)
    if keyword:
        qs = qs.filter(
            Q(username__icontains=keyword)
            | Q(display_name__icontains=keyword)
            | Q(email__icontains=keyword)
        )
    if role_id:
        qs = qs.filter(role_id=role_id)
    if status:
        qs = qs.filter(status=status)
    total = qs.count()
    offset = (page - 1) * page_size
    return qs[offset : offset + page_size], total


def _iso(value):
    return value.isoformat() if value else None


def _role_map(role_ids) -> dict[str, Role]:
    ids = {rid for rid in role_ids if rid}
    if not ids:
        return {}
    return {r.id: r for r in Role.objects.filter(id__in=ids)}


def load_permissions(role_id: str | None) -> tuple[Role | None, list[str]]:
    """返回 (role, 权限码列表)。resource 为 * 时只返回 permission 本身，与前端 hasPermission 对齐。"""
    if not role_id:
        return None, []
    role = Role.objects.filter(id=role_id, status="active").first()
    if not role:
        return None, []
    if role.code == "admin":
        return role, ["*"]
    perms: list[str] = []
    for row in RolePermission.objects.filter(role_id=role.id):
        code = (row.permission or "").strip()
        if not code:
            continue
        if row.resource and row.resource not in ("*", ""):
            code = f"{code}:{row.resource}"
        if code not in perms:
            perms.append(code)
    return role, perms


def serialize_user(user: User, role: Role | None = None) -> dict:
    if role is None and user.role_id:
        role = Role.objects.filter(id=user.role_id).first()
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email or "",
        "displayName": user.display_name or "",
        "roleId": user.role_id or "",
        "roleCode": role.code if role else "",
        "roleName": role.name if role else "",
        "clientId": user.client_id or "",
        "status": user.status,
        "lastLoginAt": _iso(user.last_login_at),
        "loginFailCount": user.login_fail_count or 0,
        "createdAt": _iso(user.created_at),
        "updatedAt": _iso(user.updated_at),
    }


def serialize_me(user: User) -> dict:
    role, permissions = load_permissions(user.role_id)
    data = serialize_user(user, role)
    data["permissions"] = permissions
    return data


def require_role(role_id: str) -> Role:
    role = Role.objects.filter(id=role_id, status="active").first()
    if not role:
        raise ApiError("角色不存在或已禁用", 400)
    return role


def _admin_active_count(exclude_id: str | None = None) -> int:
    admin_ids = list(Role.objects.filter(code="admin").values_list("id", flat=True))
    qs = User.objects.filter(role_id__in=admin_ids, status="active")
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.count()


def create_user(data: dict, *, client_id: str = "") -> User:
    username = (data.get("username") or "").strip()
    if User.objects.filter(username=username).exists():
        raise ApiError("用户名已存在", 400)
    email = (data.get("email") or "").strip() or None
    if email and User.objects.filter(email=email).exists():
        raise ApiError("邮箱已被使用", 400)
    require_role(data["role_id"])
    validate_password(data["password"], username=username)
    status = data.get("status") or "active"
    if status == "active":
        # 席位门禁（0=不限；私有化超限告警放行，SaaS 拒绝）
        from open_api.entitlements import gate_resource

        gate_resource(client_id, "seats")
    user = User(
        username=username,
        email=email,
        display_name=(data.get("display_name") or "").strip(),
        password_hash=hash_password(data["password"]),
        role_id=data["role_id"],
        client_id=client_id or "",
        status=status,
    )
    user.save()
    return user


def update_user(user_id: str, data: dict) -> User | None:
    user = User.objects.filter(id=user_id).first()
    if not user:
        return None
    # 客户归属不允许通过编辑接口变更（用户不跨客户迁移）
    data.pop("client_id", None)
    if "role_id" in data and data["role_id"]:
        require_role(data["role_id"])
    if "email" in data:
        email = (data.get("email") or "").strip() or None
        if email and User.objects.filter(email=email).exclude(id=user_id).exists():
            raise ApiError("邮箱已被使用", 400)
        data["email"] = email
    new_status = data.get("status")
    if new_status in ("disabled", "locked"):
        role = Role.objects.filter(id=user.role_id).first()
        if role and role.code == "admin" and _admin_active_count(exclude_id=user.id) == 0:
            raise ApiError("不能停用最后一个管理员", 400)
    if new_status == "active" and user.status != "active":
        from open_api.entitlements import gate_seats_on_toggle

        gate_seats_on_toggle(user.client_id or "", True)
    if "password" in data and data["password"]:
        validate_password(data["password"], username=user.username)
        user.password_hash = hash_password(data.pop("password"))
    for key in ("email", "display_name", "role_id", "status"):
        if key in data:
            setattr(user, key, data[key])
    user.save()
    return user


def delete_user(user_id: str, *, operator_id: str = "") -> None:
    if operator_id and user_id == operator_id:
        raise ApiError("不能删除当前登录账号", 400)
    user = User.objects.filter(id=user_id).first()
    if not user:
        raise ApiError("用户不存在", 404)
    role = Role.objects.filter(id=user.role_id).first()
    if role and role.code == "admin" and _admin_active_count(exclude_id=user.id) == 0:
        raise ApiError("不能删除最后一个管理员", 400)
    user.delete()


def update_last_login(user: User) -> None:
    user.last_login_at = timezone.now()
    user.login_fail_count = 0
    user.save(update_fields=["last_login_at", "login_fail_count", "updated_at"])


def increment_login_fail(user: User) -> None:
    user.login_fail_count = (user.login_fail_count or 0) + 1
    if user.login_fail_count >= 5:
        user.status = "locked"
    user.save(update_fields=["login_fail_count", "status", "updated_at"])


def authenticate_user(username: str, password: str) -> User:
    user = get_user_by_username((username or "").strip())
    if not user:
        raise ApiError("用户名或密码错误", 401)
    if user.status == "locked":
        raise ApiError("账号已锁定，请联系管理员", 403)
    if user.status != "active":
        raise ApiError("账号已被禁用", 403)
    if not verify_password(password, user.password_hash):
        increment_login_fail(user)
        user.refresh_from_db(fields=["status", "login_fail_count"])
        if user.status == "locked":
            raise ApiError("连续登录失败次数过多，账号已锁定", 403)
        raise ApiError("用户名或密码错误", 401)
    return user


def change_password(user: User, old_password: str, new_password: str) -> None:
    if not verify_password(old_password, user.password_hash):
        raise ApiError("原密码不正确", 400)
    if old_password == new_password:
        raise ApiError("新密码不能与原密码相同", 400)
    validate_password(new_password, username=user.username)
    user.password_hash = hash_password(new_password)
    user.login_fail_count = 0
    user.save(update_fields=["password_hash", "login_fail_count", "updated_at"])


def generate_password_reset_token(user: User) -> tuple[str, "datetime"]:
    """生成密码重置令牌，有效期 30 分钟。返回 (token, expires_at)。"""
    import secrets
    from datetime import timedelta
    from django.utils import timezone
    from iam.models import PasswordResetToken

    token = secrets.token_urlsafe(32)
    expires_at = timezone.now() + timedelta(minutes=30)
    prt = PasswordResetToken.objects.create(
        user_id=user.id,
        token=token,
        expires_at=expires_at,
    )
    return token, expires_at


def list_roles(*, include_disabled: bool = True):
    qs = Role.objects.all().order_by("created_at")
    if not include_disabled:
        qs = qs.filter(status="active")
    return qs


def serialize_role(role: Role) -> dict:
    perms = list(RolePermission.objects.filter(role_id=role.id).values_list("permission", flat=True))
    return {
        "id": role.id,
        "code": role.code,
        "name": role.name,
        "description": role.description or "",
        "status": role.status,
        "permissions": perms,
        "protected": role.code == "admin",
        "userCount": User.objects.filter(role_id=role.id).count(),
        "createdAt": _iso(role.created_at),
    }


def _replace_permissions(role: Role, permissions: list | None) -> None:
    if permissions is None:
        return
    codes = []
    for item in permissions:
        code = str(item or "").strip()
        if not code:
            continue
        if code not in codes:
            codes.append(code)
    RolePermission.objects.filter(role_id=role.id).delete()
    RolePermission.objects.bulk_create(
        [
            RolePermission(role_id=role.id, permission=code, resource="*")
            for code in codes
        ]
    )


def create_role(data: dict) -> Role:
    code = (data.get("code") or "").strip()
    name = (data.get("name") or "").strip()
    if not code or not name:
        raise ApiError("请填写角色编码和名称", 400)
    if Role.objects.filter(code=code).exists():
        raise ApiError("角色编码已存在", 400)
    if Role.objects.filter(name=name).exists():
        raise ApiError("角色名称已存在", 400)
    role = Role.objects.create(
        code=code,
        name=name,
        description=(data.get("description") or "").strip(),
        status=data.get("status") or "active",
    )
    _replace_permissions(role, data.get("permissions"))
    return role


def update_role(role_id: str, data: dict) -> Role:
    role = Role.objects.filter(id=role_id).first()
    if not role:
        raise ApiError("角色不存在", 404)
    if "name" in data and data.get("name"):
        name = str(data.get("name")).strip()
        if Role.objects.filter(name=name).exclude(id=role.id).exists():
            raise ApiError("角色名称已存在", 400)
        role.name = name
    if "description" in data:
        role.description = (data.get("description") or "").strip()
    if "status" in data and data.get("status") in ("active", "disabled"):
        if role.code == "admin" and data.get("status") == "disabled":
            raise ApiError("不能禁用超级管理员角色", 400)
        role.status = data["status"]
    if "code" in data and data.get("code") and data.get("code") != role.code:
        raise ApiError("角色编码不可修改", 400)
    role.save()
    if "permissions" in data:
        _replace_permissions(role, data.get("permissions"))
    return role


def delete_role(role_id: str) -> None:
    role = Role.objects.filter(id=role_id).first()
    if not role:
        raise ApiError("角色不存在", 404)
    if role.code == "admin":
        raise ApiError("不能删除超级管理员角色", 400)
    if User.objects.filter(role_id=role.id).exists():
        raise ApiError("仍有用户使用该角色，请先调整用户角色", 400)
    RolePermission.objects.filter(role_id=role.id).delete()
    role.delete()
