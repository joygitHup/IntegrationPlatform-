"""Form-Based 类型 SSO 接入：A 系统绑定 B 系统的账号密码。

中台代填场景：用户先在中台登记 B 系统的账号密码（AES 加密存中台），
中台调 B 系统的登录接口，自动提交表单，把生成的会话返回给浏览器。

A 系统的 SDK 封装：
1. bind_credentials：让用户登记 B 系统的账号密码
2. launch：调中台 /api/sso/login?appId=xxx&userId=xxx，中台代填
"""
from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import get_config


def bind_credentials(
    *,
    api_key: str,
    app_id: str,
    user_id: str,
    username: str,
    password: str,
    external_username: str = "",
) -> dict | None:
    """让用户绑定 B 系统的账号密码（中台 AES 加密存储）。"""
    cfg = get_config()
    url = f"{cfg['platform_url'].rstrip('/')}/api/apps/bindings"
    body = {
        "appId": app_id,
        "userId": user_id,
        "credentials": {"username": username, "password": password},
        "externalUsername": external_username or username,
    }
    req = Request(url, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Api-Key", api_key)
    req.add_header("X-Environment", cfg.get("environment", "dev"))
    try:
        with urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", "ignore")
            return json.loads(text) if text else {}
    except (HTTPError, URLError):
        return None


def launch(
    *,
    api_key: str,
    app_id: str,
    user_id: str = "",
    redirect: str = "",
) -> dict | None:
    """调中台 /api/sso/login 走 form_based 代填登录。

    返回中台代填后的会话信息（HTML 或 URL）。
    若 B 未绑定账号密码，返回 {needBinding: true}。
    """
    cfg = get_config()
    url = f"{cfg['platform_url'].rstrip('/')}/api/sso/login"
    body: dict[str, Any] = {"appId": app_id}
    if user_id:
        body["userId"] = user_id
    if redirect:
        body["redirectUrl"] = redirect
    req = Request(url, data=json.dumps(body).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Api-Key", api_key)
    req.add_header("X-Environment", cfg.get("environment", "dev"))
    try:
        with urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", "ignore")
            return json.loads(text) if text else {}
    except (HTTPError, URLError):
        return None


class FormBasedLauncher:
    """A 系统调中台 form_based 代填的封装。"""

    def __init__(self, *, api_key: str, app_id: str, platform_url: str = ""):
        cfg = get_config()
        self.api_key = api_key
        self.app_id = app_id
        self.platform_url = (platform_url or cfg["platform_url"]).rstrip("/")

    def bind(self, user_id: str, username: str, password: str, external_username: str = "") -> dict | None:
        return bind_credentials(
            api_key=self.api_key, app_id=self.app_id, user_id=user_id,
            username=username, password=password,
            external_username=external_username,
        )

    def launch(self, user_id: str = "", redirect: str = "") -> dict | None:
        return launch(
            api_key=self.api_key, app_id=self.app_id,
            user_id=user_id, redirect=redirect,
        )
