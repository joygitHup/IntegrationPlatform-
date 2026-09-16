"""
配额超限告警：私有化部署超限时不拦截请求，只告警（SaaS 模式直接拒绝）。

通道：日志 + 集成商配置的 alertWebhookUrl / alertEmail（复用 SMTP 配置）。
同一客户同一指标每天最多告警一次，避免刷屏。
"""
from __future__ import annotations

import json
import logging
from datetime import date

logger = logging.getLogger("quota")

# 进程内去重：{(client_id, metric): date}。多进程下各进程每天最多一条，可接受。
_alerted: dict[tuple[str, str], date] = {}

METRIC_LABELS = {
    "jobs": "集成任务数",
    "seats": "席位数",
    "connectors": "连接器（数据源）数",
    "api_calls": "月 API 调用次数",
    "rows": "月写入行数",
}


def _already_alerted_today(client_id: str, metric: str) -> bool:
    key = (client_id, metric)
    today = date.today()
    if _alerted.get(key) == today:
        return True
    _alerted[key] = today
    return False


def alert_over_quota(client, metric: str, *, used: int, limit: int, extra: dict | None = None) -> None:
    if client is None:
        return
    cid = str(getattr(client, "id", "") or "")
    label = METRIC_LABELS.get(metric, metric)
    body = {
        "event": "entitlement.over_quota",
        "deploymentMode": "private",
        "action": "allowed_with_alert",
        "clientId": cid,
        "clientName": getattr(client, "name", ""),
        "metric": metric,
        "metricLabel": label,
        "used": used,
        "limit": limit,
        **(extra or {}),
    }
    logger.warning("配额超限（私有化放行并告警）client=%s metric=%s used=%s limit=%s", cid, metric, used, limit)
    if cid and _already_alerted_today(cid, metric):
        return
    hook = (getattr(client, "alert_webhook_url", "") or "").strip()
    if hook:
        try:
            from urllib.request import Request, urlopen

            raw = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
            req = Request(hook, data=raw, headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(req, timeout=5):
                pass
        except Exception:
            logger.exception("配额告警 Webhook 发送失败 client=%s", cid)
    email = (getattr(client, "alert_email", "") or "").strip()
    if email:
        try:
            from executions.alerts import _send_mail

            _send_mail(
                email,
                f"[集成中台] 授权配额预警：{METRIC_LABELS.get(metric, metric)}已超限",
                json.dumps(body, ensure_ascii=False, indent=2, default=str),
            )
        except Exception:
            logger.exception("配额告警邮件发送失败 client=%s", cid)
