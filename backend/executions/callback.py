"""任务结束回执：把执行结果 POST 给集成商。失败不影响主流程。"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from typing import Any

from django.utils import timezone

logger = logging.getLogger(__name__)


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
    body = {
        "event": "job.completed",
        "jobId": job.id,
        "jobCode": job.code,
        "executionId": execution_id,
        "occurredAt": timezone.now().isoformat(),
        **payload,
    }
    raw = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
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
