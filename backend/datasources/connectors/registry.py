"""
连接器注册表。

每个连接器提供 metadata（前端动态表单）与 test_connection。
测通必须走协议级校验，不能仅凭端口或 HTTP 探活判定成功。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

SENSITIVE_FIELDS: dict[str, list[str]] = {
    "mysql": ["password"],
    "postgresql": ["password"],
    "postgres": ["password"],
    "oracle": ["password"],
    "sqlserver": ["password"],
    "dameng": ["password"],
    "kingbase": ["password"],
    "http_api": ["token", "apiKeyValue", "password"],
    "webhook": ["secret", "token"],
    "rabbitmq": ["password"],
    "kafka": ["password", "saslPassword"],
    "rocketmq": ["password"],
    "redis": ["password"],
    "mongodb": ["password"],
    "elasticsearch": ["password", "apiKey"],
    "sftp": ["password", "privateKey"],
    "ftp": ["password"],
    "s3": ["secretAccessKey"],
    "ldap": ["bindPassword"],
    "active_directory": ["bindPassword"],
    "dingtalk": ["appSecret"],
    "wecom": ["secret"],
    "feishu": ["appSecret"],
    "scim2": ["token"],
    "yonyou_u8": ["password"],
    "fenxiangxiaoke": ["appSecret"],
}


def _field(**kwargs) -> dict:
    return kwargs


def _schema(*fields) -> dict:
    return {"fields": list(fields)}


def _db_fields(port: int, extra: list | None = None) -> dict:
    fields = [
        _field(name="host", label="主机地址", type="string", required=True, placeholder="localhost"),
        _field(name="port", label="端口", type="number", required=True, defaultValue=port),
        _field(name="database", label="数据库名", type="string", required=True),
        _field(name="user", label="用户名", type="string", required=True),
        _field(name="password", label="密码", type="password", required=True, sensitive=True),
        _field(name="connectTimeout", label="连接超时(秒)", type="number", defaultValue=10),
    ]
    if extra:
        fields.extend(extra)
    return _schema(*fields)


@dataclass
class Connector:
    type: str
    name: str
    category: str
    description: str
    type_support: str = "both"
    icon: str = ""
    version: str = "1.0.0"
    config_schema: dict = field(default_factory=lambda: {"fields": []})
    capabilities: dict = field(default_factory=lambda: {
        "canRead": True, "canWrite": True,
        "supportsFilter": True, "supportsIncremental": True,
        "supportsUpsert": True, "canDiscoverSchema": True,
    })
    auth_methods: list = field(default_factory=lambda: [
        {"type": "password", "label": "用户名密码", "default": True}
    ])

    def metadata(self) -> dict:
        return {
            "type": self.type,
            "name": self.name,
            "displayName": self.name,
            "category": self.category,
            "description": self.description,
            "icon": self.icon,
            "typeSupport": self.type_support,
            "version": self.version,
            "configSchema": self.config_schema,
            "capabilities": self.capabilities,
            "authMethods": self.auth_methods,
            "sourceSupported": self.type_support in ("source", "both"),
            "targetSupported": self.type_support in ("target", "both"),
            "features": {
                "batchRead": bool(self.capabilities.get("canRead")),
                "incrementalRead": bool(self.capabilities.get("supportsIncremental")),
                "streamingRead": bool(self.capabilities.get("supportsStreaming")),
                "batchWrite": bool(self.capabilities.get("canWrite")),
                "transactionalWrite": self.category == "database",
                "upsertSupport": bool(self.capabilities.get("supportsUpsert")),
            },
        }

    def test_connection(self, config: dict[str, Any]) -> dict[str, Any]:
        return {
            "success": False,
            "message": f"{self.name} 未实现协议级连通测试，端口/HTTP 探活不能视为账密正确",
        }


REGISTRY: dict[str, Connector] = {}


def register(connector: Connector) -> None:
    REGISTRY[connector.type] = connector
    # postgres 别名兼容前端旧枚举
    if connector.type == "postgresql":
        REGISTRY["postgres"] = connector


def list_connectors(category: str | None = None, capability: str | None = None) -> list[dict]:
    items = list(REGISTRY.values())
    # postgres 别名会重复，按 type 去重
    seen = set()
    unique = []
    for c in items:
        if c.type in seen:
            continue
        seen.add(c.type)
        unique.append(c)
    if category:
        unique = [c for c in unique if c.category == category]
    if capability == "read":
        unique = [c for c in unique if c.type_support in ("source", "both")]
    elif capability == "write":
        unique = [c for c in unique if c.type_support in ("target", "both")]
    return [c.metadata() for c in unique]


def get_connector(type_name: str) -> Connector | None:
    return REGISTRY.get(type_name)


def connector_supports_upsert(type_name: str) -> bool:
    from datasources.config_utils import normalize_type

    conn = get_connector(normalize_type(type_name))
    if not conn:
        return False
    caps = conn.capabilities or {}
    if "supportsUpsert" in caps:
        return bool(caps["supportsUpsert"])
    return True


def test_connection(type_name: str, config: dict) -> dict:
    import time

    start = time.monotonic()
    connector = get_connector(type_name)
    if not connector:
        return {"success": False, "message": f"未知连接器类型: {type_name}", "latencyMs": 0}
    errors = []
    for f in connector.config_schema.get("fields", []):
        if f.get("required") and not config.get(f["name"]):
            errors.append(f"缺少必填字段: {f['label']}")
    if errors:
        return {"success": False, "message": "; ".join(errors), "latencyMs": 0}
    from datasources.connectors.runtime import try_test

    real = try_test(type_name, config)
    elapsed = int((time.monotonic() - start) * 1000)
    if real is not None:
        real.setdefault("latencyMs", elapsed)
        return real
    return {
        "success": False,
        "message": f"{connector.name} 未实现协议级连通测试，不能仅凭目录列出或端口开放判定成功",
        "latencyMs": elapsed,
    }


# -------------------- 注册内置连接器 --------------------
register(Connector(
    type="mysql", name="MySQL", category="database",
    description="MySQL / MariaDB 数据库连接器，支持全量和增量同步",
    config_schema=_db_fields(3306, [_field(name="charset", label="字符集", type="string", defaultValue="utf8mb4")]),
))
register(Connector(
    type="postgresql", name="PostgreSQL", category="database",
    description="PostgreSQL 数据库连接器，支持全量和增量同步",
    config_schema=_db_fields(5432, [
        _field(name="schema", label="Schema", type="string", defaultValue="public"),
        _field(name="ssl", label="启用SSL", type="boolean", defaultValue=False),
    ]),
))
register(Connector(
    type="oracle", name="Oracle", category="database",
    description="Oracle 数据库连接器",
    config_schema=_db_fields(1521, [_field(name="serviceName", label="服务名", type="string", required=True)]),
))
register(Connector(
    type="sqlserver", name="SQL Server", category="database",
    description="Microsoft SQL Server 连接器",
    config_schema=_db_fields(1433),
))
register(Connector(
    type="dameng", name="达梦", category="database",
    description="达梦数据库连接器",
    config_schema=_db_fields(5236),
))
register(Connector(
    type="kingbase", name="人大金仓", category="database",
    description="人大金仓数据库连接器",
    config_schema=_db_fields(54321),
))
register(Connector(
    type="mongodb", name="MongoDB", category="database",
    description="MongoDB 文档数据库",
    config_schema=_db_fields(27017),
    capabilities={"canRead": True, "canWrite": True, "supportsFilter": True, "supportsIncremental": True, "supportsUpsert": True, "canDiscoverSchema": True},
))
register(Connector(
    type="elasticsearch", name="Elasticsearch", category="database",
    description="Elasticsearch 搜索引擎",
    config_schema=_schema(
        _field(name="host", label="主机", type="string", required=True),
        _field(name="port", label="端口", type="number", defaultValue=9200),
        _field(name="username", label="用户名", type="string"),
        _field(name="password", label="密码", type="password", sensitive=True),
    ),
))
register(Connector(
    type="redis", name="Redis", category="messaging",
    description="Redis 缓存 / 队列",
    config_schema=_schema(
        _field(name="host", label="主机", type="string", required=True),
        _field(name="port", label="端口", type="number", defaultValue=6379),
        _field(name="password", label="密码", type="password", sensitive=True),
        _field(name="db", label="DB", type="number", defaultValue=0),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": True, "supportsUpsert": False},
))
register(Connector(
    type="rabbitmq", name="RabbitMQ", category="messaging",
    description="RabbitMQ 消息队列",
    config_schema=_schema(
        _field(name="host", label="主机", type="string", required=True),
        _field(name="port", label="端口", type="number", defaultValue=5672),
        _field(name="username", label="用户名", type="string"),
        _field(name="password", label="密码", type="password", sensitive=True),
        _field(name="vhost", label="Virtual Host", type="string", defaultValue="/"),
        _field(name="queue", label="队列名", type="string"),
        _field(name="exchange", label="交换机", type="string"),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": True, "supportsUpsert": False},
))
register(Connector(
    type="kafka", name="Kafka", category="messaging",
    description="Apache Kafka",
    config_schema=_schema(
        _field(name="brokers", label="Brokers", type="string", required=True, placeholder="localhost:9092"),
        _field(name="topic", label="Topic", type="string"),
        _field(name="groupId", label="消费组", type="string"),
        _field(name="saslPassword", label="SASL 密码", type="password", sensitive=True),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": True, "supportsUpsert": False},
))
register(Connector(
    type="rocketmq", name="RocketMQ", category="messaging",
    description="Apache RocketMQ",
    config_schema=_schema(
        _field(name="nameServer", label="NameServer", type="string", required=True),
        _field(name="topic", label="Topic", type="string"),
        _field(name="group", label="Group", type="string"),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": True, "supportsUpsert": False},
))
register(Connector(
    type="http_api", name="HTTP API", category="api",
    description="通用 HTTP / REST API",
    config_schema=_schema(
        _field(name="baseUrl", label="Base URL", type="string", required=True, placeholder="https://api.example.com"),
        _field(name="authType", label="认证方式", type="select", defaultValue="none",
              options=[{"value": "none", "label": "无"}, {"value": "bearer", "label": "Bearer"},
                       {"value": "basic", "label": "Basic"}, {"value": "apikey", "label": "API Key"}]),
        _field(name="token", label="Token", type="password", sensitive=True, showWhen={"field": "authType", "value": "bearer"}),
        _field(name="apiKeyHeader", label="API Key Header", type="string", showWhen={"field": "authType", "value": "apikey"}),
        _field(name="apiKeyValue", label="API Key", type="password", sensitive=True, showWhen={"field": "authType", "value": "apikey"}),
        _field(name="timeoutMs", label="超时(毫秒)", type="number", defaultValue=15000),
    ),
    auth_methods=[{"type": "token", "label": "Token"}, {"type": "apikey", "label": "API Key"}, {"type": "anonymous", "label": "无认证", "default": True}],
))
register(Connector(
    type="webhook", name="Webhook", category="api",
    description="可作为写入目标，也可按 URL GET 抽取作为源；推数仍走任务 ingest/hooks",
    type_support="both",
    config_schema=_schema(
        _field(name="url", label="回调 / 拉取 URL", type="string", required=True),
        _field(name="secret", label="签名密钥", type="password", sensitive=True),
        _field(name="method", label="方法", type="select", defaultValue="POST",
              options=[{"value": "GET", "label": "GET"}, {"value": "POST", "label": "POST"}, {"value": "PUT", "label": "PUT"}]),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsUpsert": True},
))
register(Connector(
    type="sftp", name="SFTP", category="file",
    description="SFTP 文件传输",
    config_schema=_schema(
        _field(name="host", label="主机", type="string", required=True),
        _field(name="port", label="端口", type="number", defaultValue=22),
        _field(name="username", label="用户名", type="string", required=True),
        _field(name="password", label="密码", type="password", sensitive=True),
        _field(name="remotePath", label="远程路径", type="string"),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": False, "supportsUpsert": False},
))
register(Connector(
    type="ftp", name="FTP", category="file",
    description="FTP 文件传输",
    config_schema=_schema(
        _field(name="host", label="主机", type="string", required=True),
        _field(name="port", label="端口", type="number", defaultValue=21),
        _field(name="username", label="用户名", type="string"),
        _field(name="password", label="密码", type="password", sensitive=True),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": False, "supportsUpsert": False},
))
register(Connector(
    type="s3", name="S3", category="file",
    description="S3 兼容对象存储",
    config_schema=_schema(
        _field(name="endpoint", label="Endpoint", type="string", required=True),
        _field(name="bucket", label="Bucket", type="string", required=True),
        _field(name="accessKeyId", label="Access Key", type="string", required=True),
        _field(name="secretAccessKey", label="Secret Key", type="password", required=True, sensitive=True),
        _field(name="region", label="Region", type="string", defaultValue="us-east-1"),
    ),
    auth_methods=[{"type": "iam", "label": "Access Key"}],
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": False, "supportsUpsert": False},
))
register(Connector(
    type="csv_excel", name="CSV / Excel", category="file",
    description="本地或共享目录 CSV / Excel 文件",
    config_schema=_schema(
        _field(name="filePath", label="文件路径", type="string", required=True),
        _field(name="encoding", label="编码", type="string", defaultValue="utf-8"),
        _field(name="hasHeader", label="含表头", type="boolean", defaultValue=True),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsIncremental": False, "supportsUpsert": False},
))
register(Connector(
    type="ldap", name="LDAP", category="saas",
    description="LDAP 目录服务（读/写 + 通讯录双向同步）",
    config_schema=_schema(
        _field(name="url", label="LDAP URL", type="string", required=True, placeholder="ldap://localhost:389"),
        _field(name="bindDn", label="Bind DN", type="string", required=True),
        _field(name="bindPassword", label="密码", type="password", required=True, sensitive=True),
        _field(name="baseDn", label="Base DN", type="string", required=True),
    ),
    type_support="both",
))
register(Connector(
    type="active_directory", name="Active Directory", category="saas",
    description="Windows AD（读/写 + 通讯录双向同步）",
    config_schema=_schema(
        _field(name="host", label="域控主机", type="string", required=True),
        _field(name="port", label="端口", type="number", defaultValue=389),
        _field(name="bindDn", label="Bind DN", type="string", required=True),
        _field(name="bindPassword", label="密码", type="password", required=True, sensitive=True),
        _field(name="baseDn", label="Base DN", type="string", required=True),
    ),
    type_support="both",
))
register(Connector(
    type="scim2", name="SCIM 2.0", category="saas",
    description="SCIM 2.0 身份协议",
    config_schema=_schema(
        _field(name="baseUrl", label="SCIM Base URL", type="string", required=True),
        _field(name="token", label="Bearer Token", type="password", required=True, sensitive=True),
    ),
))
register(Connector(
    type="dingtalk", name="钉钉", category="saas",
    description="钉钉通讯录 双向同步（读/写）",
    config_schema=_schema(
        _field(name="appKey", label="AppKey", type="string", required=True),
        _field(name="appSecret", label="AppSecret", type="password", required=True, sensitive=True),
        _field(name="corpId", label="CorpId", type="string"),
        _field(name="allowHardDelete", label="允许真删（默认禁用）", type="boolean", defaultValue=False),
    ),
    type_support="both",
    auth_methods=[{"type": "apikey", "label": "AppKey/Secret"}],
))
register(Connector(
    type="wecom", name="企业微信", category="saas",
    description="企业微信通讯录 双向同步（读/写）",
    config_schema=_schema(
        _field(name="corpId", label="CorpId", type="string", required=True),
        _field(name="secret", label="Secret", type="password", required=True, sensitive=True),
        _field(name="agentId", label="AgentId", type="string"),
        _field(name="allowHardDelete", label="允许真删（默认禁用）", type="boolean", defaultValue=False),
    ),
    type_support="both",
))
register(Connector(
    type="feishu", name="飞书", category="saas",
    description="飞书通讯录",
    config_schema=_schema(
        _field(name="appId", label="App ID", type="string", required=True),
        _field(name="appSecret", label="App Secret", type="password", required=True, sensitive=True),
    ),
    type_support="source",
))
register(Connector(
    type="yonyou_u8", name="用友 U8 ERP", category="saas",
    description="用友 U8 ERP 接口",
    config_schema=_schema(
        _field(name="baseUrl", label="接口地址", type="string", required=True),
        _field(name="account", label="账套", type="string", required=True),
        _field(name="username", label="用户名", type="string", required=True),
        _field(name="password", label="密码", type="password", required=True, sensitive=True),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsUpsert": False},
))
register(Connector(
    type="fenxiangxiaoke", name="纷享销客 CRM", category="saas",
    description="纷享销客 CRM",
    config_schema=_schema(
        _field(name="appId", label="AppId", type="string", required=True),
        _field(name="appSecret", label="AppSecret", type="password", required=True, sensitive=True),
        _field(name="permanentCode", label="永久授权码", type="string"),
    ),
    capabilities={"canRead": True, "canWrite": True, "supportsUpsert": False},
))
