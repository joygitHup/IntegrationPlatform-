"""开放错误码目录与状态页文案。稳定 code 供集成商对照，勿随意改语义。"""
from __future__ import annotations

ERROR_CATALOG = [
    {"code": "UNAUTHORIZED", "http": 401, "message": "缺少或无效的 API Key"},
    {"code": "IP_DENIED", "http": 403, "message": "调用方 IP 不在白名单"},
    {"code": "RATE_LIMITED", "http": 429, "message": "超过每分钟请求上限"},
    {"code": "QUOTA_EXCEEDED", "http": 429, "message": "超过月度调用或写入行配额"},
    {"code": "SANDBOX_ENV", "http": 403, "message": "沙箱凭证不能操作生产环境资源"},
    {"code": "NOT_FOUND", "http": 404, "message": "资源不存在或不属于当前密钥"},
    {"code": "IDEMPOTENT_REPLAY", "http": 200, "message": "同一 Idempotency-Key 返回首次结果"},
    {"code": "CONNECTOR_UNSUPPORTED", "http": 400, "message": "连接器尚未实现真实读写"},
    {"code": "DRIVER_MISSING", "http": 400, "message": "服务器未安装对应数据库驱动"},
    {"code": "VALIDATION", "http": 400, "message": "请求参数或映射规则不合法"},
]

CHANGELOG = [
    {"version": "1.3.0", "date": "2026-09-09", "items": [
        "MongoDB / ES / SFTP / FTP / S3 / CSV、飞书 / 用友 / 纷享 / SCIM 真实 Extract/Load；钉钉/企微/AD 可作为 ETL 源",
        "控制台数据源/任务/应用可指派所属集成商，对方 Key 可见并调用",
        "POST /open/register 自助沙箱开户；官方 Python / TypeScript SDK",
    ]},
    {"version": "1.2.0", "date": "2026-09-09", "items": [
        "数据源结构探测与字段映射预览",
        "Oracle / SQL Server / 达梦 / 金仓真实抽取写入",
        "集成商用量、沙箱、Workspace 与环境晋升",
        "Webhook Idempotency-Key 与 Cron 多实例租约",
        "开放错误码、状态与 changelog",
    ]},
    {"version": "1.1.0", "date": "2026-09-09", "items": [
        "租户隔离、密钥轮换、身份拉取、告警与回滚",
        "DAG / 双向防回环 / MQ / OAuth2 / SAML / Prometheus / Celery",
    ]},
    {"version": "1.0.0", "date": "2026-09-08", "items": [
        "开放目录、API Key、HTTP/MySQL/PostgreSQL ETL、入站 Webhook、完成回调、OpenAPI",
    ]},
]
