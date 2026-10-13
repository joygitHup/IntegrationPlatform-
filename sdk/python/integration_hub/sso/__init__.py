"""B 系统 SSO 接入 SDK。

5 种 SSO 类型统一入口：
- jwt / ticket: 调 verify_token(token) 验签 / 消费票据
- oauth2: OAuth2Client 走授权码 + userinfo
- saml: SamlSP 解析断言
- form_based: 由中台代填，B 不需要 SDK

最小接入：
    from integration_hub.sso import configure
    configure(platform_url="http://127.0.0.1:8000", audience="app_bbb")
    # Django: 装中间件 + 挂路由
    MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]
"""
from __future__ import annotations

_config = {
    "platform_url": "http://127.0.0.1:8000",
    "audience": "",          # 本应用 code（RS256 aud 校验）
    "app_id": "",            # 本应用 id（HS256 / ticket 调 validate 用）
    "app_secret": "",        # HS256 模式可选：本地直接验签，避免调中台 validate
    "auto_create_user": False,
    "local_session_key": "user_id",
    "default_redirect": "/dashboard",
    # 本地验签成功后是否再回调中台确认未被踢下线（默认 True：
    # 中台有 session 吊销即时生效机制，默认开启避免集成商拿到过期本地 session）
    "check_revocation": True,
    # 中台签发者；留空时同时接受 URL 形式与历史 "integration-platform"
    "issuer": "",
}


def configure(**kwargs) -> None:
    """全局配置 SDK。所有键可选。"""
    _config.update(kwargs)


def get_config() -> dict:
    return _config


# 子模块
from . import jwks  # noqa: E402,F401  公钥缓存工具
from .jwt_mode import verify_token, verify_token_local  # noqa: E402,F401
from .ticket_mode import consume_ticket  # noqa: E402,F401
from .oauth2_mode import OAuth2Client, exchange_code, authorization_url, create_pkce_pair  # noqa: E402,F401
from .saml_mode import SamlSP, metadata_xml, create_authn_request, parse_assertion  # noqa: E402,F401
from .form_mode import FormBasedLauncher, bind_credentials, launch  # noqa: E402,F401
from . import middleware  # noqa: E402,F401  Django/Flask 通用中间件

__all__ = [
    "configure", "get_config",
    "verify_token", "verify_token_local",
    "consume_ticket",
    "OAuth2Client", "exchange_code", "authorization_url", "create_pkce_pair",
    "SamlSP", "metadata_xml", "create_authn_request", "parse_assertion",
    "FormBasedLauncher", "bind_credentials", "launch",
    "middleware",
]
