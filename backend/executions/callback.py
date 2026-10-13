"""任务结束回执：把执行结果 POST 给集成商。失败不影响主流程。"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any

from django.utils import timezone

logger = logging.getLogger(__name__)

_SENSITIVE_KEYS = {
    "password", "secret", "api_key", "apiKey", "apiSecret", "secretKey",
    "token", "access_token", "refresh_token", "authorization",
    "private_key", "privateKey", "client_secret", "clientSecret",
    "session_key", "sessionKey", "cookie",
}


def _redact_payload(obj) -> Any:
    """递归清除 payload 里的敏感字段，防止数据源密码/密钥泄露到回执。"""
    if isinstance(obj, dict):
        return {
            k: _redact_payload("***") if str(k).lower() in _SENSITIVE_KEYS else _redact_payload(v)
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_redact_payload(x) for x in obj]
    if isinstance(obj, str) and len(obj) > 200:
        return obj[:200] + "…"
    return obj


def partner_client(job):
    """代配任务用 client_id；集成商自建任务 created_by 即密钥。"""
    try:
        from open_api.models import IntegrationClient
    except Exception:
        return None
    for cid in (getattr(job, "client_id", "") or "", getattr(job, "created_by", "") or ""):
        if not cid:
            continue
        client = IntegrationClient.objects.filter(id=cid).first()
        if client:
            return client
    return None


def resolve_callback_url(job) -> str:
    url = (getattr(job, "callback_url", None) or "").strip()
    if url:
        return url
    client = partner_client(job)
    if client:
        return (getattr(client, "callback_url", None) or "").strip()
    return ""


def notify_execution(job, *, execution_id: str, payload: dict[str, Any]) -> None:
    url = resolve_callback_url(job)
    if not url:
        return
    # 只拿稳定摘要字段：集成商回调不应收到原始执行 payload
    body = {
        "event": "job.completed",
        "jobId": job.id,
        "jobCode": job.code,
        "jobName": job.name,
        "executionId": execution_id,
        "occurredAt": timezone.now().isoformat(),
        "status": payload.get("status") or "",
        "processedRows": payload.get("processedRows"),
        "successRows": payload.get("successRows"),
        "failedRows": payload.get("failedRows"),
    }
    # 若 payload 里含敏感字段（conflict / context 里可能藏 password），也一并脱敏
    safe_body = _redact_payload(body)
    # 额外字段（errorMessage 等）走脱敏后再拼
    extras = {
        k: _redact_payload(v)
        for k, v in payload.items()
        if k not in ("status", "processedRows", "successRows", "failedRows")
    }
    if extras:
        safe_body = {**safe_body, **extras}
    raw = json.dumps(safe_body, ensure_ascii=False, default=str).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "integration-platform-callback",
        "X-Job-Id": job.id,
        "X-Execution-Id": execution_id,
    }
    secret = (getattr(job, "webhook_secret", None) or "").strip()
    if secret:
        digest = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
        headers["X-Hub-Signature-256"] = f"sha256={digest}"
    try:
        from urllib.request import Request, urlopen

        req = Request(url, data=raw, headers=headers, method="POST")
        with urlopen(req, timeout=8) as resp:
            logger.info("执行回执已发送 status=%s job=%s", getattr(resp, "status", ""), job.code)
    except Exception:
        logger.exception("执行回执失败 job=%s url=%s", job.code, url)
