"""SSO 应用 CRUD。"""
from __future__ import annotations

from django.db.models import Q

from core.exceptions import ApiError
from sso.app_utils import generate_app_secret, validate_app_payload
from sso.models import Application


def list_apps(**filters):
    qs = Application.objects.all().order_by("sort_order", "-created_at")
    keyword = filters.get("keyword")
    if keyword:
        qs = qs.filter(Q(name__icontains=keyword) | Q(code__icontains=keyword))
    if filters.get("category"):
        qs = qs.filter(category=filters["category"])
    if filters.get("status"):
        qs = qs.filter(status=filters["status"])
    if filters.get("login_type"):
        qs = qs.filter(login_type=filters["login_type"])
    if filters.get("visible") is True:
        qs = qs.filter(visible=True)
    if filters.get("client_id"):
        qs = qs.filter(client_id=filters["client_id"])
    if filters.get("partner_id"):
        from open_api.tenancy import partner_q

        qs = qs.filter(partner_q(filters["partner_id"]))
    elif filters.get("created_by"):
        qs = qs.filter(created_by=filters["created_by"])
    if filters.get("environment"):
        qs = qs.filter(environment=filters["environment"])
    if filters.get("workspace_id"):
        from open_api.tenancy import workspace_q

        qs = qs.filter(workspace_q(filters["workspace_id"], partner=bool(filters.get("partner_id"))))
    return qs


def create_app(data: dict, created_by: str) -> tuple[Application, str]:
    data = validate_app_payload(data, partial=False)
    if Application.objects.filter(code=data["code"]).exists():
        raise ApiError("应用编码已存在", 400)
    secret = data.get("secret_key") or generate_app_secret()
    app = Application(
        name=data["name"],
        code=data["code"],
        description=data.get("description") or "",
        icon=data.get("icon") or "",
        category=data.get("category") or "business",
        login_type=data.get("login_type") or "jwt",
        login_url=data.get("login_url") or "",
        logout_url=data.get("logout_url") or "",
        callback_url=data.get("callback_url") or "",
        secret_key=secret,
        settings=data.get("settings") or {},
        jwt_algorithm=data.get("jwt_algorithm") or "HS256",
        jwt_expires_in=data.get("jwt_expires_in") or 30,
        ticket_expires_in=data.get("ticket_expires_in") or 60,
        oauth_client_id=data.get("oauth_client_id") or "",
        oauth_client_secret=data.get("oauth_client_secret") or "",
        oauth_auth_url=data.get("oauth_auth_url") or "",
        oauth_token_url=data.get("oauth_token_url") or "",
        oauth_userinfo_url=data.get("oauth_userinfo_url") or "",
        oauth_scope=data.get("oauth_scope") or "",
        saml_idp_metadata_url=data.get("saml_idp_metadata_url") or "",
        saml_sp_entity_id=data.get("saml_sp_entity_id") or "",
        saml_cert=data.get("saml_cert") or "",
        account_mapping=data.get("account_mapping") or "same_username",
        mapping_attribute=data.get("mapping_attribute") or "",
        sort_order=data.get("sort_order") or 0,
        visible=True if data.get("visible") is None else bool(data.get("visible")),
        status=data.get("status") or "active",
        created_by=created_by,
        client_id=data.get("client_id") or "",
        workspace_id=data.get("workspace_id") or "",
        environment=data.get("environment") or "",
    )
    if not app.environment:
        from core.env import default_environment

        app.environment = default_environment()
    app.save()
    return app, secret


def update_app(app_id: str, data: dict) -> Application | None:
    app = Application.objects.filter(id=app_id).first()
    if not app:
        return None
    data = validate_app_payload(data, partial=True, existing=app)
    # 客户归属不允许通过编辑变更
    data.pop("client_id", None)
    skip = {"id", "created_at", "created_by", "code", "secret_key", "client_id"}
    for key, value in data.items():
        if key in skip or not hasattr(app, key):
            continue
        if key in ("oauth_client_secret", "saml_cert") and isinstance(value, str) and value.startswith("***"):
            continue
        setattr(app, key, value)
    app.save()
    return app
