"""入站请求幂等：同一密钥 + Idempotency-Key 返回首次结果。"""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response


def header_key(request) -> str:
    return (
        request.META.get("HTTP_IDEMPOTENCY_KEY")
        or request.META.get("HTTP_X_IDEMPOTENCY_KEY")
        or ""
    ).strip()[:128]


def _scope(request, path: str) -> str:
    # 严格按客户隔离幂等记录；平台用户回退到用户级
    from core.tenancy import principal_client_id

    cid = principal_client_id(request)
    if cid:
        return cid
    ctx = getattr(request, "auth_ctx", None)
    return getattr(ctx, "user_id", "") or f"anon:{path}"


def replay_response(request, path: str):
    key = header_key(request)
    if not key:
        return None
    from open_api.models import IdempotencyRecord

    scope = _scope(request, path)
    rec = IdempotencyRecord.objects.filter(scope=scope, key=key).first()
    if rec:
        if rec.expires_at and rec.expires_at < timezone.now():
            rec.delete()
            return None
        return Response(rec.response_json, status=rec.status_code)
    return None


def store_response(request, path: str, payload: dict, status_code: int = 200) -> None:
    key = header_key(request)
    if not key:
        return
    from open_api.models import IdempotencyRecord

    scope = _scope(request, path)
    if IdempotencyRecord.objects.filter(scope=scope, key=key).exists():
        return
    IdempotencyRecord.objects.create(
        scope=scope,
        key=key,
        path=path[:200],
        status_code=status_code,
        response_json=payload,
        expires_at=timezone.now() + timedelta(hours=24),
    )
