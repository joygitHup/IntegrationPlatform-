"""失败告警：邮件 / Webhook。与任务完成回执分开，只在失败时发送。"""
from __future__ import annotations

import json
import logging
import smtplib
from email.message import EmailMessage

from django.conf import settings

logger = logging.getLogger(__name__)


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


def notify_failure_alert(job, payload: dict) -> None:
    status = payload.get("status") or ""
    if status not in ("failed", "partial_failed", "error"):
        return
    email, hook = _alert_targets(job)
    if not email and not hook:
        return
    body = {
        "event": "job.failed",
        "jobId": job.id,
        "jobCode": job.code,
        "jobName": job.name,
        **payload,
    }
    if hook:
        try:
            from urllib.request import Request, urlopen

            raw = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
            req = Request(hook, data=raw, headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(req, timeout=8):
                pass
        except Exception:
            logger.exception("失败告警 Webhook 发送失败 job=%s", job.code)
    if email:
        _send_mail(email, f"[集成中台] 任务失败 {job.name}", json.dumps(body, ensure_ascii=False, indent=2, default=str))


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
