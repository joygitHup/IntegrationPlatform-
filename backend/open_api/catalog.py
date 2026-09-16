"""开放服务能力目录：应用 / 数据 / 消息 / 身份，供集成商按类型接入。"""
from __future__ import annotations

DEFAULT_SCOPES = [
    "catalog:read",
    "app:read",
    "app:write",
    "datasource:read",
    "datasource:write",
    "job:read",
    "job:write",
    "job:execute",
    "execution:read",
    "sso:launch",
]


def build_catalog() -> dict:
    from datasources.connectors.registry import list_connectors
    from org_sync.templates import TEMPLATES

    connectors = list_connectors()
    by_cat: dict[str, list[str]] = {}
    for item in connectors:
        by_cat.setdefault(item.get("category") or "other", []).append(item.get("type"))

    types = [
        {
            "code": "application",
            "name": "应用集成",
            "description": "把业务系统登记为应用，通过中台签发 JWT / Ticket 实现免登跳转（A→中台→B）。",
            "protocols": ["jwt", "ticket", "oauth2", "saml", "form_based"],
            "quickStart": [
                "POST /api/open/apps 登记应用并保存 secretKey",
                "目标系统实现 /sso/consume 验签",
                "来源系统点击时 GET /api/sso/launch?from=编码&to=编码&token=来源JWT",
            ],
            "endpoints": [
                {"method": "POST", "path": "/api/open/apps", "desc": "登记应用"},
                {"method": "GET", "path": "/api/open/apps", "desc": "应用列表"},
                {"method": "GET", "path": "/api/sso/launch", "desc": "跨系统免登跳转"},
                {"method": "POST", "path": "/api/sso/validate", "desc": "校验 Ticket / Token"},
            ],
        },
        {
            "code": "data",
            "name": "数据集成",
            "description": "接入库表 / API / 文件等数据源，配置字段映射后全量或增量同步。",
            "connectorCategories": {
                "database": by_cat.get("database") or [],
                "api": by_cat.get("api") or [],
                "file": by_cat.get("file") or [],
                "saas": by_cat.get("saas") or [],
            },
            "quickStart": [
                "GET /api/open/openapi.json 拉取规范并生成客户端（openapi-generator-cli）",
                "GET /api/open/connectors 查看连接器与配置 Schema",
                "POST /api/open/datasources 登记源、目标数据源",
                "POST /api/open/datasources/inspect 探测表/字段，POST /api/open/jobs/preview 预览映射",
                "POST /api/open/jobs 创建映射任务，POST /api/open/jobs/trigger 抽取写入",
                "源系统也可 POST /api/open/hooks/{任务编码} 推数（建议带 Idempotency-Key）",
                "GET /api/open/me 查看用量；Workspace 表示最终客户，晋升用 POST /api/open/jobs/promote",
                "POST /api/open/register 自助开通沙箱；运营也可在控制台把已有数据源/任务指派给该密钥",
            ],
            "runtime": ["http_api", "mysql", "postgresql", "oracle", "sqlserver", "dameng", "kingbase", "mongodb", "elasticsearch", "sftp", "ftp", "s3", "csv_excel", "feishu", "yonyou_u8", "fenxiangxiaoke", "scim2", "dingtalk", "wecom", "ldap", "active_directory", "kafka", "rabbitmq", "redis", "rocketmq"],
            "endpoints": [
                {"method": "POST", "path": "/api/open/register", "desc": "自助开通沙箱 API Key"},
                {"method": "GET", "path": "/api/open/sdk", "desc": "官方 SDK 安装与示例"},
                {"method": "GET", "path": "/api/open/openapi.json", "desc": "OpenAPI 规范"},
                {"method": "GET", "path": "/api/open/connectors", "desc": "连接器目录"},
                {"method": "POST", "path": "/api/open/datasources", "desc": "登记数据源"},
                {"method": "POST", "path": "/api/open/datasources/test", "desc": "测试连通"},
                {"method": "POST", "path": "/api/open/datasources/inspect", "desc": "探测表结构与样例"},
                {"method": "POST", "path": "/api/open/jobs", "desc": "创建同步任务"},
                {"method": "POST", "path": "/api/open/jobs/preview", "desc": "映射预览"},
                {"method": "POST", "path": "/api/open/jobs/trigger", "desc": "触发抽取写入"},
                {"method": "POST", "path": "/api/open/jobs/ingest", "desc": "推送数据或触发"},
                {"method": "POST", "path": "/api/open/jobs/promote", "desc": "复制任务到目标环境"},
                {"method": "POST", "path": "/api/open/jobs/rollback", "desc": "快照回滚（execute=true 真正写入）"},
                {"method": "POST", "path": "/api/open/hooks/{code}", "desc": "入站 Webhook"},
                {"method": "GET", "path": "/api/open/executions", "desc": "执行记录"},
                {"method": "GET", "path": "/api/open/me", "desc": "当前密钥档案与用量"},
                {"method": "GET", "path": "/api/open/workspaces", "desc": "最终客户 Workspace"},
                {"method": "GET", "path": "/api/open/errors", "desc": "错误码目录"},
                {"method": "GET", "path": "/api/open/status", "desc": "服务状态"},
            ],
        },
        {
            "code": "messaging",
            "name": "消息集成",
            "description": "对接 Kafka / RabbitMQ / RocketMQ / Redis，作为源或目标参与同步管道。",
            "connectorTypes": by_cat.get("messaging") or [],
            "runtime": ["kafka", "rabbitmq", "redis", "rocketmq"],
            "quickStart": [
              "登记 Kafka / RabbitMQ / Redis / RocketMQ 数据源并测试连通",
              "任务 sourceConfig.topic / queue 作为消费目标，写入则生产消息",
            ],
            "endpoints": [
                {"method": "GET", "path": "/api/open/connectors?category=messaging", "desc": "消息类连接器"},
            ],
        },
        {
            "code": "identity",
            "name": "身份与组织同步",
            "description": "从钉钉 / 企微 / AD 拉取通讯录，也可作为普通 ETL 任务的抽取源（table=users|departments）；目标侧请用数据库/HTTP/SCIM。",
            "templates": [{"id": t["id"], "name": t["name"], "category": t.get("category")} for t in TEMPLATES],
            "quickStart": [
                "GET /api/open/templates 取预置映射",
                "登记钉钉 / 企微 / LDAP 数据源后 POST /api/open/identity/pull 拉取通讯录",
                "或把该数据源配成任务 source，sourceConfig.table=users 走 ETL Extract",
                "创建 job 时带 templateType 与 fieldMapping；可 executeJob 写入目标",
            ],
            "runtime": ["dingtalk", "wecom", "ldap", "active_directory"],
            "endpoints": [
                {"method": "GET", "path": "/api/open/templates", "desc": "同步模板"},
                {"method": "POST", "path": "/api/open/identity/pull", "desc": "从钉钉/企微/AD 拉取用户与部门"},
                {"method": "GET", "path": "/api/org-departments", "desc": "部门树（JWT 或 API Key，需 jobId）"},
            ],
        },
    ]
    return {
        "product": "integration-platform",
        "role": "integration-hub",
        "summary": "中台对外只提供集成服务：集成商按类型接入应用、数据、消息与身份，快速落地业务。",
        "auth": {
            "header": "X-Api-Key",
            "altHeader": "Authorization: Bearer ipk_...",
            "note": "可 POST /api/open/register 自助开通沙箱密钥，或由控制台代配后把资源指派给该密钥。GET /api/open/sdk 获取官方 Python / TypeScript SDK。运营在控制台创建数据源/任务时选择「所属集成商」，对方即可用 Key 调用。",
        },
        "types": types,
        "connectorCount": len(connectors),
    }
