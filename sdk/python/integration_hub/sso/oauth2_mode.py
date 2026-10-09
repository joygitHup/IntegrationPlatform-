"""OAuth2 类型 SSO 接入：A 系统作为 OAuth2 客户端接入中台。

  1. A 后端引导用户跳转到中台 /api/oauth/authorize
  2. 用户在中台登录后回调 A 的 redirect_uri，带 code
  3. A 后端用 code 调 /api/oauth/token 拿 access_token
  4. A 后端调 /api/oauth/userinfo 拿用户身份
  5. A 后端建本地会话

支持 PKCE（code_verifier + code_challenge S256）。
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from . import get_config


def _post_form(url: str, body: dict, *, basic_auth: tuple[str, str] | None = None) -> dict:
    data = urlencode(body).encode("utf-8")
    req = Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    if basic_auth:
        import base64 as b64
        cred = b64.b64encode(f"{basic_auth[0]}:{basic_auth[1]}".encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {cred}")
    try:
        with urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", "ignore")
            return json.loads(text) if text else {}
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"OAuth2 token 请求失败: {exc}") from exc


def _get_json(url: str, access_token: str) -> dict:
    req = Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {access_token}")
    try:
        with urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", "ignore")
            return json.loads(text) if text else {}
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"OAuth2 userinfo 请求失败: {exc}") from exc


def create_pkce_pair() -> tuple[str, str]:
    """返回 (code_verifier, code_challenge)。S256 算法。"""
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def authorization_url(
    *,
    client_id: str,
    redirect_uri: str,
    state: str,
    scope: str = "openid profile email",
    code_challenge: str = "",
    extra: dict | None = None,
) -> str:
    """生成跳转到中台 /api/oauth/authorize 的 URL。"""
    cfg = get_config()
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": scope,
    }
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = "S256"
    if extra:
        params.update(extra)
    return f"{cfg['platform_url'].rstrip('/')}/api/oauth/authorize?{urlencode(params)}"


def exchange_code(
    code: str,
    state: str = "",
    *,
    client_id: str = "",
    client_secret: str = "",
    redirect_uri: str = "",
    code_verifier: str = "",
) -> dict | None:
    """用授权码换 access_token，再调 userinfo 拿用户身份。

    返回 {access_token, refresh_token, expires_in, user_info} 或 None。
    """
    cfg = get_config()
    if not client_id:
        client_id = cfg.get("app_id", "")
    if not redirect_uri:
        redirect_uri = cfg.get("redirect_uri", "")
    token_url = f"{cfg['platform_url'].rstrip('/')}/api/oauth/token"
    body = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }
    if client_id:
        body["client_id"] = client_id
    if client_secret:
        body["client_secret"] = client_secret
    if code_verifier:
        body["code_verifier"] = code_verifier
    basic_auth = (client_id, client_secret) if client_secret else None
    token_resp = _post_form(token_url, body, basic_auth=basic_auth)
    access_token = token_resp.get("access_token")
    if not access_token:
        return None
    userinfo_url = f"{cfg['platform_url'].rstrip('/')}/api/oauth/userinfo"
    user_info = _get_json(userinfo_url, access_token)
    return {
        "access_token": access_token,
        "refresh_token": token_resp.get("refresh_token", ""),
        "expires_in": token_resp.get("expires_in", 0),
        "user_info": user_info,
    }


class OAuth2Client:
    """封装 OAuth2 授权码流程，方便 A 系统接入。"""

    def __init__(
        self,
        client_id: str,
        client_secret: str = "",
        redirect_uri: str = "",
        *,
        platform_url: str = "",
        scope: str = "openid profile email",
    ):
        cfg = get_config()
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.platform_url = (platform_url or cfg["platform_url"]).rstrip("/")
        self.scope = scope

    def create_authorization_url(self, state: str) -> tuple[str, str, str]:
        """返回 (url, code_verifier, state)。code_verifier 让调用方在 callback 时传回。"""
        verifier, challenge = create_pkce_pair()
        url = authorization_url(
            client_id=self.client_id,
            redirect_uri=self.redirect_uri,
            state=state,
            scope=self.scope,
            code_challenge=challenge,
        )
        return url, verifier, state

    def exchange(self, code: str, code_verifier: str = "") -> dict | None:
        return exchange_code(
            code,
            client_id=self.client_id,
            client_secret=self.client_secret,
            redirect_uri=self.redirect_uri,
            code_verifier=code_verifier,
        )
