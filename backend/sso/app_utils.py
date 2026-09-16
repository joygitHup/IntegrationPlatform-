"""应用创建/更新校验。字段与前端 app-form / appsApi 对齐。"""
from __future__ import annotations

import secrets

from core.exceptions import ApiError

APP_CODE_PATTERN = r"^[a-zA-Z][a-zA-Z0-9_-]*$"
LOGIN_TYPES = ("jwt", "ticket", "oauth2", "saml", "form_based")
CATEGORIES = ("business", "data", "devops", "collaboration", "other")


def generate_app_secret() -> str:
    return secrets.token_urlsafe(32)


def validate_app_payload(data: dict, *, partial: bool = False, existing=None) -> dict:
    result = dict(data)
    login_type = result.get("login_type") or (getattr(existing, "login_type", None) if existing else "jwt")
    login_type = login_type or "jwt"
    if login_type not in LOGIN_TYPES:
        raise ApiError(f"不支持的登录方式: {login_type}", 400)

    login_url = result.get("login_url") if "login_url" in result else (getattr(existing, "login_url", "") if existing else "")
    if login_type in ("jwt", "ticket", "form_based") and not str(login_url or "").strip():
        if not partial or "login_url" in result or "login_type" in result:
            raise ApiError("JWT / Ticket / 表单代填需要填写登录地址", 400)

    if login_type == "oauth2":
        auth_url = result.get("oauth_auth_url") if "oauth_auth_url" in result else (getattr(existing, "oauth_auth_url", "") if existing else "")
        if not str(auth_url or "").strip() and (not partial or "oauth_auth_url" in result or "login_type" in result):
            raise ApiError("OAuth2 需要填写授权地址", 400)

    if "category" in result and result["category"] and result["category"] not in CATEGORIES:
        raise ApiError("不支持的应用分类", 400)

    return result
