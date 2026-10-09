"""JWT 类型 SSO 接入：B 系统验签中台签发的 RS256/HS256 token。

两种模式：
- 本地验签（推荐）：拉 JWKS 公钥本地验签，零密钥保管、零回调中台
- 回调验签：调中台 /api/sso/validate（兼容老应用 + 实时吊销）
"""
from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import jwt

from . import get_config


def _acceptable_issuers(cfg: dict) -> list[str] | None:
    """issuer 白名单：显式配置值 + platform_url 推导的 URL issuer + 历史字符串。"""
    issuers: list[str] = []
    if cfg.get("issuer"):
        issuers.append(cfg["issuer"])
    # 从 platform_url 自动推导：http://host → http://host/api
    if cfg.get("platform_url"):
        issuers.append(cfg["platform_url"].rstrip("/") + "/api")
    # 历史兼容：老版本中台 iss 固定为该字符串
    issuers.append("integration-platform")
    # 去重保序
    seen = set()
    result = []
    for i in issuers:
        if i not in seen:
            seen.add(i)
            result.append(i)
    return result


def verify_token(token: str) -> dict | None:
    """验签中台签发的 SSO JWT，返回用户信息 dict 或 None。

    优先尝试本地 JWKS 验签（RS256），失败回退到 HS256 本地验签
    （app_secret 已配置时），再失败回退到回调中台 /api/sso/validate。
    check_revocation=True 时本地验签成功后再回调中台确认未被踢下线。
    """
    cfg = get_config()
    # 1) 本地 RS256 验签
    payload = verify_token_local(token, cfg)
    if payload is not None:
        if cfg.get("check_revocation"):
            # 敏感系统：本地验签 + 中台实时确认（吊销即时生效，代价是一次往返）
            full = exchange_via_platform(token, cfg)
            if not full or not full.get("valid"):
                return None
            return full.get("user")
        return payload
    # 2) 回调中台 validate（兼容老应用 + 实时吊销）
    return _validate_via_platform(token, cfg)


def verify_token_local(token: str, cfg: dict | None = None) -> dict | None:
    """本地验签（不调中台）。RS256 用 JWKS；HS256 用 app_secret。"""
    cfg = cfg or get_config()
    issuers = _acceptable_issuers(cfg)
    # RS256：JWKS 公钥
    try:
        from .jwks import get_signing_key
        signing_key = get_signing_key(token, cfg["platform_url"])
        return jwt.decode(
            token, signing_key.key,
            algorithms=["RS256"],
            audience=cfg["audience"] or None,
            issuer=issuers,
            options={"verify_aud": bool(cfg["audience"]), "verify_iss": True},
        )
    except jwt.PyJWTError:
        pass
    except Exception:
        pass
    # HS256：本地密钥
    if cfg.get("app_secret"):
        try:
            return jwt.decode(
                token, cfg["app_secret"],
                algorithms=["HS256"],
                audience=cfg["audience"] or None,
                options={"verify_aud": False},
            )
        except jwt.PyJWTError:
            pass
    return None


def _validate_via_platform(token: str, cfg: dict) -> dict | None:
    """调中台 /api/sso/validate 验签（回调模式）。"""
    url = f"{cfg['platform_url'].rstrip('/')}/api/sso/validate"
    body = json.dumps({"token": token, "appId": cfg.get("app_id", "")}).encode("utf-8")
    req = Request(url, data=body, method="POST",
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as resp:
            text = resp.read().decode("utf-8", "ignore")
            data = json.loads(text) if text else {}
            return data.get("user") if data.get("valid") else None
    except (HTTPError, URLError):
        return None


def exchange_via_platform(token: str, cfg: dict | None = None) -> dict | None:
    """B 后端用 token 调中台 /api/sso/validate 的完整响应。

    保留给需要拿 appId / 原始 valid 字段的调用方使用。
    """
    cfg = cfg or get_config()
    url = f"{cfg['platform_url'].rstrip('/')}/api/sso/validate"
    body = json.dumps({"token": token, "appId": cfg.get("app_id", "")}).encode("utf-8")
    req = Request(url, data=body, method="POST",
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as resp:
            text = resp.read().decode("utf-8", "ignore")
            return json.loads(text) if text else {}
    except (HTTPError, URLError):
        return None
