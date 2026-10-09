"""A 系统 Launcher：让 A 的用户免登跳转到 B。

两种模式：
- Bearer 模式（推荐）：A 用户已在中台登录，A 后端拿中台 JWT 调
  GET /api/sso/redirect?to=&redirect= ，中台 302 到 B
- Token 模式（兼容老应用）：A 自己签 launch token，调
  POST /api/sso/launch，中台用 A 在中台登记的 secret_key 验签后换 B token

A 系统 5 行接入（Bearer 模式）：

    from integration_hub.launcher import Launcher
    launcher = Launcher(
        platform_url="http://127.0.0.1:8000",
        access_token=request.session["zhongtai_token"],  # A 在中台登录后保存的
    )
    return launcher.redirect_to(target="appb", redirect="/dashboard")
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import jwt


class LauncherError(RuntimeError):
    def __init__(self, message: str, status: int = 0, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class Launcher:
    """A 系统：让本系统用户免登跳转到 B 系统。"""

    def __init__(
        self,
        *,
        platform_url: str = "http://127.0.0.1:8000",
        access_token: str = "",  # Bearer 模式：A 在中台登录后的 JWT
        # Token 模式（兼容老应用）：
        source_app: str = "",
        source_secret: str = "",
        api_key: str = "",  # 或用 API Key 调 launch
        environment: str = "dev",
        workspace_id: str = "",
        user_id: str = "",
        username: str = "",
    ):
        self.platform_url = platform_url.rstrip("/")
        self.access_token = access_token
        self.source_app = source_app
        self.source_secret = source_secret
        self.api_key = api_key
        self.environment = environment
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.username = username

    def redirect_url(self, *, target: str, redirect: str = "") -> str:
        """返回跳转到 B 的免登 URL（Bearer 模式）。A 后端直接 redirect()。"""
        if not self.access_token:
            raise LauncherError("Bearer 模式需要 access_token")
        params = {"to": target}
        if redirect:
            params["redirect"] = redirect
        # 调 /api/sso/redirect，让中台 302 到 B
        # 注意：这里返回的不是中台 /sso/redirect 的 URL（让浏览器自己跳），
        # 而是直接调中台拿 302 后的最终 B URL（避免 A 前端再多一跳）。
        url = f"{self.platform_url}/api/sso/redirect?{urlencode(params)}"
        req = Request(url, method="GET")
        req.add_header("Authorization", f"Bearer {self.access_token}")
        req.add_header("X-Environment", self.environment)
        if self.workspace_id:
            req.add_header("X-Workspace-Id", self.workspace_id)
        try:
            # 关键：不跟随重定向，让调用方自己决定如何跳
            import http.client as hc
            from urllib.parse import urlparse
            parsed = urlparse(url)
            conn = hc.HTTPConnection(parsed.netloc, timeout=30)
            path = parsed.path + ("?" + parsed.query if parsed.query else "")
            conn.request("GET", path, headers={
                "Authorization": f"Bearer {self.access_token}",
                "X-Environment": self.environment,
                **({"X-Workspace-Id": self.workspace_id} if self.workspace_id else {}),
            })
            resp = conn.getresponse()
            if resp.status in (301, 302, 303, 307, 308):
                loc = resp.getheader("Location") or ""
                conn.close()
                if loc:
                    return loc
                raise LauncherError("中台未返回 Location", resp.status)
            body = resp.read().decode("utf-8", "ignore")
            conn.close()
            # 中台可能返回 JSON（form_based/oauth2/saml 等），取 url/loginUrl 字段
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                data = {}
            url_val = data.get("url") or data.get("loginUrl")
            if url_val:
                return url_val
            raise LauncherError(data.get("error") or f"中台返回 {resp.status}", resp.status, data)
        except (HTTPError, URLError, LauncherError) as exc:
            if isinstance(exc, LauncherError):
                raise
            raise LauncherError(str(exc)) from exc

    def launch_via_token(self, *, target: str, redirect: str = "") -> str:
        """Token 模式（兼容老应用）：A 自己签 launch token 调中台 /api/sso/launch。

        返回中台签发的 B 落地 URL（含 token 参数）。
        """
        if not self.source_app or not self.source_secret:
            raise LauncherError("Token 模式需要 source_app + source_secret")
        token = self._sign_launch_token()
        body = {
            "from": self.source_app,
            "to": target,
            "token": token,
            "redirectUrl": redirect,
        }
        url = f"{self.platform_url}/api/sso/launch"
        req = Request(url, data=json.dumps(body).encode("utf-8"), method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("X-Environment", self.environment)
        if self.api_key:
            req.add_header("X-Api-Key", self.api_key)
        if self.workspace_id:
            req.add_header("X-Workspace-Id", self.workspace_id)
        try:
            with urlopen(req, timeout=30) as resp:
                text = resp.read().decode("utf-8", "ignore")
                data = json.loads(text) if text else {}
                url_val = data.get("url") or data.get("loginUrl")
                if url_val:
                    return url_val
                raise LauncherError(data.get("error") or "中台未返回 URL", resp.status, data)
        except (HTTPError, URLError) as exc:
            raise LauncherError(str(exc)) from exc

    def _sign_launch_token(self) -> str:
        """A 用自己的 secret_key 签短时 JWT 作为身份凭证。"""
        now = datetime.now(timezone.utc)
        payload = {
            "sub": self.user_id,
            "username": self.username,
            "iss": self.source_app,
            "iat": now,
            "exp": now + timedelta(seconds=60),
        }
        return jwt.encode(payload, self.source_secret, algorithm="HS256")
