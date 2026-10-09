"""系统种子数据：角色、权限、默认管理员、示例 SSO 应用。"""
from __future__ import annotations

from django.db import transaction

from core.ids import generate_id
from core.password import hash_password
from iam.models import Role, RolePermission, User
from sso.models import Application

ALL_PERMISSIONS = [
    "user:read", "user:write", "user:delete",
    "role:read", "role:write",
    "datasource:read", "datasource:write", "datasource:delete",
    "job:read", "job:write", "job:execute", "job:delete",
    "execution:read", "execution:retry",
    "dlq:read", "dlq:reprocess",
    "deadletter:read", "deadletter:retry", "deadletter:delete",
    "audit:read",
    "system:read", "system:write",
    "app:read", "app:write", "app:delete",
    "application:write", "application:delete",
    "sso:audit", "sso:manage",
    "open:manage", "open:read",
]


def _get_or_create_role(code: str, name: str, description: str) -> Role:
    role = Role.objects.filter(code=code).first()
    if role:
        return role
    return Role.objects.create(code=code, name=name, description=description)


@transaction.atomic
def seed_system() -> dict:
    from open_api.partner import ensure_platform_workspace

    ensure_platform_workspace()
    if User.objects.filter(username="admin").exists():
        return {"seeded": False, "message": "系统已初始化"}

    admin = _get_or_create_role("admin", "超级管理员", "拥有系统所有权限")
    developer = _get_or_create_role("developer", "开发者", "可管理数据源和任务配置")
    operator = _get_or_create_role("operator", "运维人员", "可查看监控、处理死信、执行任务")
    viewer = _get_or_create_role("viewer", "只读用户", "仅可查看数据")

    def grant(role: Role, perms: list[str]) -> None:
        existing = set(
            RolePermission.objects.filter(role_id=role.id).values_list("permission", flat=True)
        )
        RolePermission.objects.bulk_create(
            [
                RolePermission(
                    id=generate_id("rp"),
                    role_id=role.id,
                    permission=p,
                    resource="*",
                )
                for p in perms
                if p not in existing
            ]
        )

    grant(admin, ALL_PERMISSIONS)
    grant(developer, [
        "datasource:read", "datasource:write",
        "job:read", "job:write", "job:execute",
        "execution:read", "execution:retry",
        "dlq:read", "dlq:reprocess",
        "deadletter:read", "deadletter:retry",
        "audit:read",
        "app:read",
        "open:read",
    ])
    grant(operator, [
        "datasource:read",
        "job:read", "job:execute",
        "execution:read", "execution:retry",
        "dlq:read", "dlq:reprocess",
        "deadletter:read", "deadletter:retry", "deadletter:delete",
        "audit:read",
        "open:read",
    ])
    grant(viewer, [
        "datasource:read", "job:read", "execution:read",
        "dlq:read", "deadletter:read", "audit:read", "app:read",
        "open:read",
    ])

    admin_user = User(
        username="admin",
        email="admin@integration.local",
        display_name="超级管理员",
        password_hash=hash_password("admin123"),
        role_id=admin.id,
        status="active",
    )
    admin_user.save()

    sample_apps = [
        dict(name="企业邮箱", code="email", description="企业邮箱系统单点登录", icon="📧",
             category="business", login_type="jwt", login_url="https://mail.example.com/sso/login",
             logout_url="https://mail.example.com/logout", sort_order=1),
        dict(name="OA 办公系统", code="oa", description="企业 OA 协同办公平台", icon="💼",
             category="business", login_type="ticket", login_url="https://oa.example.com/sso/ticket",
             sort_order=2),
        dict(name="CRM 客户管理", code="crm", description="客户关系管理系统", icon="👥",
             category="business", login_type="oauth2", login_url="https://crm.example.com/oauth/authorize",
             oauth_client_id="integration-platform",
             oauth_auth_url="https://crm.example.com/oauth/authorize",
             oauth_token_url="https://crm.example.com/oauth/token",
             oauth_userinfo_url="https://crm.example.com/api/userinfo", sort_order=3),
        dict(name="文档知识库", code="wiki", description="企业文档与知识管理", icon="📚",
             category="business", login_type="ticket", login_url="https://wiki.example.com/sso",
             sort_order=4),
        dict(name="数据报表平台", code="bi", description="BI 数据可视化报表", icon="📊",
             category="data", login_type="jwt", login_url="https://bi.example.com/api/sso/jwt",
             sort_order=10),
        dict(name="代码仓库", code="gitlab", description="GitLab 代码托管平台", icon="🔧",
             category="devops", login_type="oauth2", login_url="https://gitlab.example.com/oauth/authorize",
             oauth_client_id="integration-platform",
             oauth_auth_url="https://gitlab.example.com/oauth/authorize",
             oauth_token_url="https://gitlab.example.com/oauth/token",
             oauth_userinfo_url="https://gitlab.example.com/api/v4/user", sort_order=20),
    ]
    for app in sample_apps:
        if Application.objects.filter(code=app["code"]).exists():
            continue
        Application.objects.create(
            **app,
            secret_key="sso-demo-secret-key-please-change-in-production",
            status="active",
            created_by=admin_user.id,
        )

    return {"seeded": True, "message": "系统初始化成功"}
