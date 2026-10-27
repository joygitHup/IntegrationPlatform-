"""失败告警：邮件 / Webhook。与任务完成回执分开，只在失败时发送。"""
from __future__ import annotations

import json
import logging
import os
import smtplib
from email.message import EmailMessage

from django.conf import settings

logger = logging.getLogger(__name__)


def _redact_sensitive(obj) -> str:
    """递归清除 payload 里的敏感字段，防密码/密钥泄露到邮件/Webhook。"""
    sensitive_keys = {
        "password", "secret", "api_key", "apiKey", "token", "access_token", "refresh_token",
        "authorization", "private_key", "privateKey", "client_secret", "clientSecret",
    }

    def _walk(o):
        if isinstance(o, dict):
            return {
                (k if k not in sensitive_keys else "***"): _walk("***")
                if k in sensitive_keys
                else _walk(v)
                for k, v in o.items()
            }
        if isinstance(o, list):
            return [_walk(x) for x in o]
        if isinstance(o, str) and len(o) > 200:
            return o[:200] + "…"
        return o

    try:
        redacted = _walk(obj)
        return json.dumps(redacted, ensure_ascii=False, default=str)
    except Exception:
        # 无论如可失败都别打断告警主流程，也别把原始 payload 漏出去
        return json.dumps({"note": "<payload redacted due to serialization failure>"})


def _alert_targets(job) -> tuple[str, str]:
    email = (getattr(job, "alert_email", None) or "").strip()
    hook = (getattr(job, "alert_webhook_url", None) or "").strip()
    if email and hook:
        return email, hook
    from executions.callback import partner_client

    client = partner_client(job)
    if client:
        email = email or (client.alert_email or "").strip()
        hook = hook or (client.alert_webhook_url or "").strip()
    return email, hook


def _deliver(job, event: str, subject_prefix: str, body: dict, text_suffix: str = "") -> None:
    """统一发送：Webhook + 邮件。失败告警与停滞告警共用。"""
    email, hook = _alert_targets(job)
    if not email and not hook:
        return
    if hook:
        try:
            from urllib.request import Request, urlopen

            raw = json.dumps({"event": event, **body}, ensure_ascii=False, default=str).encode("utf-8")
            req = Request(hook, data=raw, headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(req, timeout=8):
                pass
        except Exception:
            logger.exception("告警 Webhook 发送失败 job=%s event=%s", job.code, event)
    if email:
        subject = f"[集成中台] {subject_prefix} {job.name}"
        text = json.dumps({"event": event, **body}, ensure_ascii=False, indent=2, default=str) + text_suffix
        _send_mail(email, subject, text)


def notify_failure_alert(job, payload: dict) -> None:
    status = payload.get("status") or ""
    if status not in ("failed", "partial_failed", "error"):
        return
    body = {
        "jobId": job.id,
        "jobCode": job.code,
        "jobName": job.name,
        "status": status,
    }
    _deliver(
        job,
        event="job.failed",
        subject_prefix="任务失败",
        body=body,
        text_suffix="\n\n原始 payload（已脱敏）:\n" + _redact_sensitive(payload),
    )


def notify_stale_watermark(job, payload: dict) -> None:
    """水位线停滞告警（连续多次执行水位线未推进）。"""
    body = {
        "jobId": job.id,
        "jobCode": job.code,
        "jobName": job.name,
        "watermarkField": getattr(job, "watermark_field", ""),
        "watermarkValue": getattr(job, "watermark_value", ""),
        "message": payload.get("message") or "增量水位线连续多次执行未推进",
    }
    _deliver(job, event="job.stale_watermark", subject_prefix="水位线停滞", body=body)


def _send_mail(to_addr: str, subject: str, text: str) -> None:
    host = getattr(settings, "SMTP_HOST", "") or ""
    if not host:
        logger.warning("未配置 SMTP_HOST，跳过邮件告警")
        return
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = getattr(settings, "SMTP_FROM", "") or getattr(settings, "SMTP_USER", "") or "noreply@localhost"
        msg["To"] = to_addr
        msg.set_content(text)
        port = int(getattr(settings, "SMTP_PORT", 587) or 587)
        user = getattr(settings, "SMTP_USER", "") or ""
        password = getattr(settings, "SMTP_PASSWORD", "") or ""
        use_tls = str(getattr(settings, "SMTP_USE_TLS", "true")).lower() in ("1", "true", "yes")
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            if use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
    except Exception:
        logger.exception("失败告警邮件发送失败 to=%s", to_addr)
