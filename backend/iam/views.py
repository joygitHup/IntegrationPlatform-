"""认证与用户管理视图。路径字段与前端 authApi / usersApi / rolesApi 对齐。"""
from __future__ import annotations

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import audit_from_request, record_audit_log
from core.exceptions import ApiError
from core.jwt import sign_access_token, sign_refresh_token, verify_token, revoke_token
from core.permissions import HasPermission, IsAuthenticated
from core.query import q, q_int
from core.tenancy import assert_platform, get_owned, principal_client_id, resolve_create_client_id
from core.throttling import check_login_rate_limit
from iam.models import User
from iam.serializers import (
    ChangePasswordSerializer,
    CreateUserSerializer,
    LoginSerializer,
    RefreshSerializer,
    RoleSerializer,
    UpdateUserSerializer,
)
from iam.seed import ALL_PERMISSIONS, seed_system
from iam.services import (
    authenticate_user,
    change_password,
    create_role,
    create_user,
    delete_role,
    delete_user,
    list_roles,
    list_users,
    serialize_me,
    serialize_role,
    serialize_user,
    update_last_login,
    update_role,
    update_user,
    _role_map,
)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        ip = (
            request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("REMOTE_ADDR")
            or "unknown"
        )
        allowed, wait_ms = check_login_rate_limit(ip, consume=False)
        if not allowed:
            return Response(
                {"error": "请求过于频繁，请稍后再试"},
                status=429,
                headers={"Retry-After": str(max(int(wait_ms / 1000), 1))},
            )

        ser = LoginSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        seed_system()
        ua = request.META.get("HTTP_USER_AGENT", "")
        try:
            user = authenticate_user(ser.validated_data["username"], ser.validated_data["password"])
        except ApiError as exc:
            check_login_rate_limit(ip, consume=True)
            record_audit_log(
                username=ser.validated_data.get("username") or "",
                action="LOGIN",
                resource_type="USER",
                resource_name=ser.validated_data.get("username") or "",
                detail={"success": False, "reason": str(exc.detail)},
                ip=ip,
                user_agent=ua,
            )
            raise
        update_last_login(user)
        access = sign_access_token(user_id=user.id, username=user.username, role_id=user.role_id)
        refresh = sign_refresh_token(user_id=user.id, username=user.username, role_id=user.role_id)
        record_audit_log(
            user_id=user.id,
            username=user.username,
            client_id=user.client_id or "",
            action="LOGIN",
            resource_type="USER",
            resource_id=user.id,
            resource_name=user.username,
            detail={"success": True},
            ip=ip,
            user_agent=ua,
        )
        return Response(
            {
                "accessToken": access,
                "refreshToken": refresh,
                "user": serialize_me(user),
            }
        )


class RefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        ser = RefreshSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        raw_token = ser.validated_data["refresh_token"]
        payload = verify_token(raw_token)
        if not payload or payload.get("type") != "refresh":
            raise ApiError("无效的 refresh token", 401)
        user = User.objects.filter(id=payload.get("userId")).first()
        if not user or user.status != "active":
            raise ApiError("无效的 refresh token", 401)
        # 旧 refresh token 吊销，签发新对（旋转）
        revoke_token(raw_token)
        access = sign_access_token(user_id=user.id, username=user.username, role_id=user.role_id)
        refresh = sign_refresh_token(user_id=user.id, username=user.username, role_id=user.role_id)
        return Response({"accessToken": access, "refreshToken": refresh})


class PasswordResetRequestView(APIView):
    """请求密码重置：管理员可指定 userId 直接重置；用户自助需提供邮箱。"""
    permission_classes = [IsAuthenticated, HasPermission]
    required_write_permission = "user:write"

    def post(self, request):
        from iam.models import PasswordResetToken
        from iam.services import generate_password_reset_token

        user_id = request.data.get("userId") or ""
        if not user_id:
            raise ApiError("请指定要重置密码的用户", 400)
        user = User.objects.filter(id=user_id).first()
        if not user:
            raise ApiError("用户不存在", 404)
        token, expires_at = generate_password_reset_token(user)
        # 如果配置了 SMTP，发送邮件；否则返回 token 给管理员
        sent = _try_send_reset_email(user, token)
        audit_from_request(
            request,
            action="PASSWORD_RESET_REQUEST",
            resource_type="USER",
            resource_id=user.id,
            resource_name=user.username,
            detail={"emailSent": sent},
        )
        result = {"success": True, "expiresAt": expires_at.isoformat()}
        if not sent:
            result["token"] = token
            result["message"] = "未配置 SMTP，请将此 token 直接交给用户"
        return Response(result)


class PasswordResetConfirmView(APIView):
    """确认密码重置：用 token + 新密码完成重置。"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        from iam.models import PasswordResetToken
        from iam.services import validate_password
        from core.password import hash_password
        from datetime import timedelta
        from django.utils import timezone

        token = (request.data.get("token") or "").strip()
        new_password = (request.data.get("newPassword") or request.data.get("new_password") or "").strip()
        if not token or not new_password:
            raise ApiError("请提供 token 和新密码", 400)

        prt = PasswordResetToken.objects.filter(token=token, used=False).first()
        if not prt:
            raise ApiError("重置令牌无效或已使用", 400)
        if prt.expires_at and prt.expires_at <= timezone.now():
            raise ApiError("重置令牌已过期", 400)

        user = User.objects.filter(id=prt.user_id).first()
        if not user:
            raise ApiError("用户不存在", 404)
        if user.status != "active":
            raise ApiError("账号已被禁用，无法重置密码", 400)

        validate_password(new_password, username=user.username)
        user.password_hash = hash_password(new_password)
        user.login_fail_count = 0
        user.save(update_fields=["password_hash", "login_fail_count", "updated_at"])

        prt.used = True
        prt.save(update_fields=["used"])
        # 吊销该用户所有已签发的 token（强制重新登录）
        from iam.models import RevokedToken
        RevokedToken.objects.filter(user_id=user.id).delete()
        record_audit_log(
            user_id=user.id,
            username=user.username,
            action="PASSWORD_RESET_CONFIRM",
            resource_type="USER",
            resource_id=user.id,
            resource_name=user.username,
            detail={"success": True},
        )
        return Response({"success": True})


def _try_send_reset_email(user, token: str) -> bool:
    """尝试发送密码重置邮件，成功返回 True。"""
    from django.conf import settings

    host = getattr(settings, "SMTP_HOST", "") or ""
    if not host or not user.email:
        return False
    try:
        import smtplib
        from email.mime.text import MIMEText

        from core.public_urls import origin_url

        link = origin_url(f"/reset-password?token={token}")
        msg = MIMEText(f"请点击以下链接重置密码：\n{link}\n\n链接有效期为 30 分钟。", "plain", "utf-8")
        msg["Subject"] = "密码重置 — 集成中台"
        msg["From"] = getattr(settings, "SMTP_FROM", "") or getattr(settings, "SMTP_USER", "") or "noreply@localhost"
        msg["To"] = user.email

        port = int(getattr(settings, "SMTP_PORT", 587) or 587)
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            if str(getattr(settings, "SMTP_USE_TLS", "true")).lower() in ("1", "true", "yes"):
                smtp.starttls()
            user_smtp = getattr(settings, "SMTP_USER", "") or ""
            pwd = getattr(settings, "SMTP_PASSWORD", "") or ""
            if user_smtp:
                smtp.login(user_smtp, pwd)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        logger.exception("发送密码重置邮件失败 user=%s: %s", user.get("username"), exc)
        return False


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        # 吊销当前 access token，使其立即失效
        header = request.META.get("HTTP_AUTHORIZATION") or ""
        if header.startswith("Bearer "):
            token = header[7:].strip()
            if token and not token.startswith("ipk_"):
                revoke_token(token)
        audit_from_request(
            request,
            action="LOGOUT",
            resource_type="USER",
            resource_id=request.auth_ctx.user_id,
            resource_name=request.auth_ctx.username,
            detail={"success": True},
        )
        return Response({"success": True})


class PasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request):
        ser = ChangePasswordSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = User.objects.filter(id=request.auth_ctx.user_id).first()
        if not user:
            raise ApiError("用户不存在", 404)
        change_password(user, ser.validated_data["old_password"], ser.validated_data["new_password"])
        audit_from_request(
            request,
            action="UPDATE",
            resource_type="USER",
            resource_id=user.id,
            resource_name=user.username,
            detail={"fields": ["password"]},
        )
        return Response({"success": True})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = getattr(request.auth_ctx, "user", None) or User.objects.filter(id=request.auth_ctx.user_id).first()
        if not user:
            raise ApiError("Unauthorized", 401)
        return Response({"user": serialize_me(user)})


class UserListView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_read_permission = "user:read"
    required_write_permission = "user:write"

    def get(self, request):
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        # 客户账号只能看本客户席位；平台账号（client_id 为空）看全部
        scope = principal_client_id(request) or None
        items, total = list_users(
            page=page,
            page_size=page_size,
            keyword=q(request, "keyword"),
            role_id=q(request, "roleId", "role_id"),
            status=q(request, "status"),
            client_scope=scope,
        )
        roles = _role_map(u.role_id for u in items)
        return Response(
            {
                "items": [serialize_user(u, roles.get(u.role_id)) for u in items],
                "total": total,
                "page": page,
                "pageSize": page_size,
            }
        )

    def post(self, request):
        ser = CreateUserSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        # 客户账号强制建到本客户；平台可指派客户（请求体 clientId 仅平台生效）
        cid = resolve_create_client_id(request, ser.validated_data)
        user = create_user(ser.validated_data, client_id=cid)
        audit_from_request(
            request,
            action="CREATE",
            resource_type="USER",
            resource_id=user.id,
            resource_name=user.username,
            detail={"username": user.username, "roleId": user.role_id, "clientId": user.client_id},
        )
        return Response(serialize_user(user))


class UserDetailView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_read_permission = "user:read"
    required_write_permission = "user:write"
    required_delete_permission = "user:delete"

    def get(self, request, id: str):
        user = get_owned(User, id, request)
        return Response(serialize_user(user))

    def put(self, request, id: str):
        get_owned(User, id, request)
        ser = UpdateUserSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        user = update_user(id, ser.validated_data)
        if not user:
            raise ApiError("用户不存在", 404)
        audit_from_request(
            request,
            action="UPDATE",
            resource_type="USER",
            resource_id=id,
            resource_name=user.username,
            detail={"fields": list(ser.validated_data.keys())},
        )
        return Response(serialize_user(user))

    def delete(self, request, id: str):
        user = get_owned(User, id, request)
        delete_user(id, operator_id=request.auth_ctx.user_id)
        audit_from_request(
            request,
            action="DELETE",
            resource_type="USER",
            resource_id=id,
            resource_name=user.username,
        )
        return Response({"success": True})


class RoleListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = [serialize_role(role) for role in list_roles()]
        return Response({"items": items, "total": len(items), "catalog": ALL_PERMISSIONS})

    def post(self, request):
        from core.permissions import has_permission

        # 角色是全局 RBAC 资产：仅平台账号可维护，客户账号一律拒绝
        assert_platform(request)
        auth = getattr(request, "auth_ctx", None)
        if not has_permission(auth, "role:write") and not has_permission(auth, "user:write"):
            raise ApiError("权限不足", 403)
        role = create_role(request.data)
        audit_from_request(
            request, action="CREATE", resource_type="ROLE",
            resource_id=role.id, resource_name=role.name,
        )
        return Response(serialize_role(role), status=201)


class RoleDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, id: str):
        from iam.models import Role

        assert_platform(request)
        role = Role.objects.filter(id=id).first()
        if not role:
            raise ApiError("角色不存在", 404)
        return Response(serialize_role(role))

    def put(self, request, id: str):
        from core.permissions import has_permission

        assert_platform(request)
        auth = getattr(request, "auth_ctx", None)
        if not has_permission(auth, "role:write") and not has_permission(auth, "user:write"):
            raise ApiError("权限不足", 403)
        role = update_role(id, request.data)
        audit_from_request(
            request, action="UPDATE", resource_type="ROLE",
            resource_id=role.id, resource_name=role.name,
        )
        return Response(serialize_role(role))

    def delete(self, request, id: str):
        from core.permissions import has_permission

        assert_platform(request)
        auth = getattr(request, "auth_ctx", None)
        if not has_permission(auth, "role:write") and not has_permission(auth, "user:write"):
            raise ApiError("权限不足", 403)
        from iam.models import Role

        role = Role.objects.filter(id=id).first()
        name = role.name if role else id
        delete_role(id)
        audit_from_request(
            request, action="DELETE", resource_type="ROLE",
            resource_id=id, resource_name=name,
        )
        return Response({"success": True})


class SeedView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        result = seed_system()
        return Response(result)
