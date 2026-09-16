"""IAM：用户 / 角色 / 权限。表名与前端 schema/iam.ts 对齐。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class Role(StringIdModel):
    ID_PREFIX = "role"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=16, default="active")  # active / disabled

    class Meta:
        db_table = "sys_roles"
        indexes = [models.Index(fields=["code"], name="idx_roles_code")]


class User(StringIdModel):
    ID_PREFIX = "usr"

    username = models.CharField(max_length=64, unique=True)
    email = models.EmailField(max_length=128, unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255)
    display_name = models.CharField(max_length=64, blank=True, default="")
    role_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    # 所属集成商："" 表示平台运营账号（可看全站）；客户账号强制非空且只能访问本客户资源
    client_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    status = models.CharField(max_length=16, default="active")  # active / disabled / locked
    last_login_at = models.DateTimeField(null=True, blank=True)
    login_fail_count = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    # DRF 认证兼容
    is_authenticated = True
    is_anonymous = False

    class Meta:
        db_table = "sys_users"
        indexes = [
            models.Index(fields=["username"], name="idx_users_username"),
            models.Index(fields=["role_id"], name="idx_users_role"),
        ]

    @property
    def is_active(self) -> bool:
        return self.status == "active"


class RolePermission(StringIdModel):
    ID_PREFIX = "rp"

    role_id = models.CharField(max_length=32, db_index=True)
    permission = models.CharField(max_length=64)
    resource = models.CharField(max_length=128, default="*")

    class Meta:
        db_table = "sys_role_permissions"
        indexes = [
            models.Index(fields=["role_id"], name="idx_role_permissions_role"),
            models.Index(fields=["role_id", "permission", "resource"], name="idx_role_permissions_uniq"),
        ]


class RevokedToken(StringIdModel):
    """JWT 吊销黑名单：logout 时写入 jti，认证时校验。"""
    ID_PREFIX = "rev"

    jti = models.CharField(max_length=64, unique=True, db_index=True)
    token_type = models.CharField(max_length=16, default="access")  # access / refresh
    user_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "sys_revoked_tokens"
        indexes = [
            models.Index(fields=["jti"], name="idx_revoked_jti"),
            models.Index(fields=["expires_at"], name="idx_revoked_expires"),
        ]


class PasswordResetToken(StringIdModel):
    """密码重置令牌：管理员或用户请求重置时生成，确认重置时校验。"""
    ID_PREFIX = "prt"

    user_id = models.CharField(max_length=64, db_index=True)
    token = models.CharField(max_length=128, unique=True, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    used = models.BooleanField(default=False)

    class Meta:
        db_table = "sys_password_reset_tokens"
        indexes = [
            models.Index(fields=["token"], name="idx_pwreset_token"),
            models.Index(fields=["user_id"], name="idx_pwreset_user"),
        ]
