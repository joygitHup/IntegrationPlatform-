"""对外绝对 URL 的单一事实来源。

生产经 Nginx / 网关反向代理时，Django 看到的 Host 常常是内网地址，
``request.build_absolute_uri()`` 会据此生成集成商不可达的链接（jwks_uri、
回调地址、邮件链接等）。因此所有对外绝对 URL 必须统一从本模块生成：

    口径 = PUBLIC_BASE_URL（对外 origin） + PUBLIC_API_PREFIX（对外 API 路径）

- api_url("/sso/.well-known/jwks.json") → API 前缀下的完整 URL
- origin_url("/reset-password")          → 站点根下的完整 URL（控制台页面）
- canonical_issuer()                     → SSO/OIDC iss 标识
"""
from __future__ import annotations


def public_origin() -> str:
    """对外 origin，如 https://hub.example.com（无路径、无尾斜杠）。"""
    from django.conf import settings

    return (getattr(settings, "PUBLIC_BASE_URL", "") or "").rstrip("/")


def api_prefix() -> str:
    """对外 API 路径前缀，如 /api；API 暴露在根域名时为空串。"""
    from django.conf import settings

    return getattr(settings, "PUBLIC_API_PREFIX", "/api")


def api_base_url() -> str:
    """对外 API 基址，如 https://hub.example.com/api。"""
    from django.conf import settings

    cached = getattr(settings, "PUBLIC_API_BASE_URL", "")
    if cached:
        return cached.rstrip("/")
    return (public_origin() + api_prefix()).rstrip("/")


def canonical_issuer() -> str:
    """SSO/OIDC 签发者标识（默认等于 API 基址，可被 SSO_ISSUER 覆盖）。"""
    from django.conf import settings

    return (getattr(settings, "SSO_ISSUER", "") or api_base_url()).rstrip("/")


def _join(base: str, path: str) -> str:
    if not path:
        return base.rstrip("/")
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


def api_url(path: str) -> str:
    """API 前缀下的对外绝对 URL。path 形如 /sso/.well-known/jwks.json。"""
    return _join(api_base_url(), path)


def origin_url(path: str) -> str:
    """站点根下的对外绝对 URL。path 形如 /reset-password。"""
    return _join(public_origin(), path)
