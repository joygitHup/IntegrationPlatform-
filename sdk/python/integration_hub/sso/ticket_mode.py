"""Ticket 类型 SSO 接入：B 系统消费一次性票据。

  B 落地页从 URL 取 ?ticket=xxx → consume_ticket(ticket) 调中台 validate
  → 拿到用户信息 → 建本地会话。

票据特性（与 JWT 不同）：
- 一次性消费，用后即焚（中台 SsoTicket.status=consumed）
- 不能本地验签，必须回调中台
- 适用于"链接分享/邮件邀请"等场景
"""
from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import get_config


def consume_ticket(ticket: str) -> dict | None:
    """消费一次性 ticket，返回用户信息 dict 或 None。"""
    cfg = get_config()
    url = f"{cfg['platform_url'].rstrip('/')}/api/sso/validate"
    body = json.dumps({"ticket": ticket, "appId": cfg.get("app_id", "")}).encode("utf-8")
    req = Request(url, data=body, method="POST",
                  headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=10) as resp:
            text = resp.read().decode("utf-8", "ignore")
            data = json.loads(text) if text else {}
            return data.get("user") if data.get("valid") else None
    except (HTTPError, URLError):
        return None
