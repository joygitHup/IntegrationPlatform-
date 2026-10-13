"""
JWT 双 Token：access 8h + refresh 7d。

Payload 字段与前端 jwt.ts / auth-context 对齐：
  userId, username, roleId, type('access'|'refresh'), jti
响应字段：accessToken / refreshToken。

吊销机制：logout 时将 token 的 jti 写入 RevokedToken 表，
认证时校验 jti 是否在黑名单中。过期 token 的黑名单记录由定时任务清理。
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from django.conf import settings


def _parse_duration(text: str) -> timedelta:
    text = (text or "").strip().lower()
    if text.endswith("h"):
        return timedelta(hours=int(text[:-1] or 8))
    if text.endswith("d"):
        return timedelta(days=int(text[:-1] or 7))
    if text.endswith("m"):
        return timedelta(minutes=int(text[:-1] or 30))
    if text.endswith("s"):
        return timedelta(seconds=int(text[:-1] or 30))
    return timedelta(hours=8)


def _secret() -> str:
    return getattr(settings, "JWT_SECRET", "integration-platform-jwt-secret-2024")


def sign_access_token(*, user_id: str, username: str, role_id: str) -> str:
    exp = datetime.now(timezone.utc) + _parse_duration(
        getattr(settings, "JWT_ACCESS_EXPIRES", "8h")
    )
    payload = {
        "userId": user_id,
        "username": username,
        "roleId": role_id or "",
        "type": "access",
        "jti": uuid.uuid4().hex,
        "exp": exp,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


def sign_refresh_token(*, user_id: str, username: str, role_id: str) -> str:
    exp = datetime.now(timezone.utc) + _parse_duration(
        getattr(settings, "JWT_REFRESH_EXPIRES", "7d")
    )
    payload = {
        "userId": user_id,
        "username": username,
        "roleId": role_id or "",
        "type": "refresh",
        "jti": uuid.uuid4().hex,
        "exp": exp,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _secret(), algorithm="HS256")


def verify_token(token: str) -> dict[str, Any] | None:
    """校验签名+过期+jti 黑名单。"""
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    # 检查 jti 是否已被吊销
    jti = payload.get("jti")
    if jti and _is_revoked(jti):
        return None
    return payload


def _is_revoked(jti: str) -> bool:
    """检查 jti 是否在吊销黑名单中。

    认证路径不允许静默降级：数据库异常直接抛，让上层记录并告警。
    黑名单只阻断已明确吊销的令牌；数据库不可用属于基础设施故障，
    应触发监控而非悄悄放过。
    """
    import logging

    logger = logging.getLogger(__name__)
    try:
        from iam.models import RevokedToken
        return RevokedToken.objects.filter(jti=jti).exists()
    except Exception:
        logger.exception("吊销黑名单查询异常 jti=%s", jti)
        raise


def revoke_token(token: str) -> bool:
    """将 token 加入吊销黑名单。返回是否成功写入。"""
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"], options={"verify_exp": False})
    except jwt.PyJWTError:
        return False

    jti = payload.get("jti")
    if not jti:
        return False

    from iam.models import RevokedToken
    exp = payload.get("exp")
    expires_at = None
    if exp:
        expires_at = datetime.fromtimestamp(exp, tz=timezone.utc)

    obj, created = RevokedToken.objects.get_or_create(
        jti=jti,
        defaults={
            "token_type": payload.get("type", "access"),
            "user_id": payload.get("userId", ""),
            "expires_at": expires_at,
        },
    )
    return created


def purge_revoked_tokens() -> int:
    """清理已过期的吊销记录。返回清理条数。"""
    from iam.models import RevokedToken
    now = datetime.now(timezone.utc)
    deleted, _ = RevokedToken.objects.filter(expires_at__lt=now).delete()
    return deleted
