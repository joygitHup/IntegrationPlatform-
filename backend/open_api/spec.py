"""OpenAPI 3.0：仅覆盖 /api/open/* 供集成商生成客户端。"""
from __future__ import annotations


def build_openapi() -> dict:
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "集成中台开放服务",
            "version": "1.0.0",
            "description": (
                "中台对外只提供服务。用 API Key 接入应用、数据、消息与身份。\n\n"
                "鉴权：`X-Api-Key: ipk_...` 或 `Authorization: Bearer ipk_...`。\n"
                "密钥按客户端隔离资源；可配置 IP 白名单与每分钟限流。\n"
                "目录、连接器、模板、本规范无需密钥。"
            ),
        },
        "servers": [{"url": "/api", "description": "当前环境"}],
        "tags": [
            {"name": "catalog", "description": "能力目录"},
            {"name": "apps", "description": "应用集成"},
            {"name": "data", "description": "数据集成"},
            {"name": "jobs", "description": "任务与执行"},
            {"name": "identity", "description": "身份拉取"},
            {"name": "hooks", "description": "入站 Webhook"},
        ],
        "components": {
            "securitySchemes": {
                "ApiKeyHeader": {"type": "apiKey", "in": "header", "name": "X-Api-Key"},
                "ApiKeyBearer": {"type": "http", "scheme": "bearer", "bearerFormat": "ipk"},
            },
            "schemas": {
                "Error": {"type": "object", "properties": {"error": {"type": "string"}}},
                "JobQueued": {
                    "type": "object",
                    "properties": {
                        "executionId": {"type": "string"},
                        "queueJobId": {"type": "string"},
                        "status": {"type": "string", "example": "queued"},
                    },
                },
                "CallbackEvent": {
                    "type": "object",
                    "description": "任务结束后中台 POST 到 callbackUrl 的报文",
                    "properties": {
                        "event": {"type": "string", "example": "job.completed"},
                        "jobId": {"type": "string"},
                        "jobCode": {"type": "string"},
                        "executionId": {"type": "string"},
                        "status": {"type": "string", "enum": ["success", "partial_failed", "failed"]},
                        "totalRows": {"type": "integer"},
                        "successRows": {"type": "integer"},
                        "failedRows": {"type": "integer"},
                        "skippedRows": {"type": "integer"},
                        "watermark": {"type": "string"},
                        "errorMessage": {"type": "string"},
                        "occurredAt": {"type": "string", "format": "date-time"},
                    },
                },
            },
        },
        "security": [{"ApiKeyHeader": []}, {"ApiKeyBearer": []}],
        "paths": {
            "/open/catalog": {
                "get": {
                    "tags": ["catalog"], "security": [], "summary": "能力目录",
                    "responses": {"200": {"description": "应用 / 数据 / 消息 / 身份"}},
                }
            },
            "/open/openapi.json": {
                "get": {
                    "tags": ["catalog"], "security": [], "summary": "本 OpenAPI 文档",
                    "responses": {"200": {"description": "OpenAPI 3.0 JSON"}},
                }
            },
            "/open/connectors": {
                "get": {
                    "tags": ["catalog"], "security": [], "summary": "连接器与配置 Schema",
                    "parameters": [
                        {"name": "category", "in": "query", "schema": {"type": "string"}},
                        {"name": "type", "in": "query", "schema": {"type": "string"}},
                    ],
                    "responses": {"200": {"description": "连接器列表或单个详情"}},
                }
            },
            "/open/templates": {
                "get": {
                    "tags": ["catalog"], "security": [], "summary": "用户同步模板",
                    "responses": {"200": {"description": "预置映射模板"}},
                }
            },
            "/open/apps": {
                "get": {"tags": ["apps"], "summary": "应用列表", "responses": {"200": {"description": "OK"}}},
                "post": {
                    "tags": ["apps"], "summary": "登记应用（返回 secretKey 仅一次）",
                    "responses": {"200": {"description": "含 secretKey"}},
                },
            },
            "/open/datasources": {
                "get": {"tags": ["data"], "summary": "数据源列表", "responses": {"200": {"description": "OK"}}},
                "post": {
                    "tags": ["data"], "summary": "登记数据源",
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {
                            "type": "object",
                            "required": ["name", "code", "type"],
                            "properties": {
                                "name": {"type": "string"},
                                "code": {"type": "string"},
                                "type": {"type": "string", "enum": ["http_api", "mysql", "postgresql", "oracle", "sqlserver", "dameng", "kingbase", "webhook"]},
                                "config": {"type": "object"},
                            },
                        }}},
                    },
                    "responses": {"200": {"description": "数据源（敏感字段已脱敏）"}},
                },
            },
            "/open/datasources/test": {
                "post": {
                    "tags": ["data"], "summary": "测试连通（HTTP/MySQL/PostgreSQL 走真实驱动）",
                    "responses": {"200": {"description": "{ success, message }"}},
                }
            },
            "/open/jobs": {
                "get": {"tags": ["jobs"], "summary": "任务列表", "responses": {"200": {"description": "OK"}}},
                "post": {
                    "tags": ["jobs"],
                    "summary": "创建同步任务",
                    "description": "sourceConfig.table / path 为源表或 HTTP 路径。callbackUrl 用于执行回执。",
                    "responses": {"200": {"description": "任务（含 webhookSecret）"}},
                },
            },
            "/open/jobs/trigger": {
                "post": {
                    "tags": ["jobs"], "summary": "触发 Extract→Load",
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {"jobId": {"type": "string"}, "code": {"type": "string"}},
                    }}}},
                    "responses": {"200": {"description": "queued", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/JobQueued"}}}}},
                }
            },
            "/open/jobs/ingest": {
                "post": {
                    "tags": ["hooks"],
                    "summary": "推送数据或触发抽取",
                    "description": "带 records 则跳过 Extract，直接转换写入目标；不带则从源抽取。重复提交请带 Idempotency-Key / X-Idempotency-Key。",
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {
                            "jobId": {"type": "string"},
                            "code": {"type": "string"},
                            "records": {"type": "array", "items": {"type": "object"}},
                            "trigger": {"type": "boolean"},
                        },
                    }}}},
                    "responses": {"200": {"description": "queued"}},
                }
            },
            "/open/hooks/{code}": {
                "post": {
                    "tags": ["hooks"],
                    "summary": "源系统入站 Webhook（API Key 或 X-Webhook-Secret）",
                    "security": [],
                    "parameters": [{"name": "code", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "requestBody": {"content": {"application/json": {"schema": {
                        "oneOf": [
                            {"type": "array", "items": {"type": "object"}},
                            {"type": "object"},
                        ]
                    }}}},
                    "responses": {"200": {"description": "queued"}},
                }
            },
            "/open/executions": {
                "get": {"tags": ["jobs"], "summary": "执行记录", "responses": {"200": {"description": "OK"}}}
            },
            "/open/jobs/rollback": {
                "post": {
                    "tags": ["jobs"],
                    "summary": "按快照回滚目标数据",
                    "description": "默认只返回 plan；execute=true 时把 snapshotData 写回目标数据源。",
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "required": ["jobId"],
                        "properties": {
                            "jobId": {"type": "string"},
                            "snapshotId": {"type": "string"},
                            "targetVersion": {"type": "integer"},
                            "execute": {"type": "boolean", "default": False},
                        },
                    }}}},
                    "responses": {"200": {"description": "plan 与可选 result"}},
                }
            },
            "/open/identity/pull": {
                "post": {
                    "tags": ["identity"],
                    "summary": "从钉钉 / 企微 / LDAP 拉取用户与部门",
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "required": ["datasourceId"],
                        "properties": {
                            "datasourceId": {"type": "string"},
                            "jobId": {"type": "string"},
                            "syncOrg": {"type": "boolean", "default": True},
                            "executeJob": {"type": "boolean", "default": False},
                        },
                    }}}},
                    "responses": {"200": {"description": "users / departments 摘要"}},
                }
            },
            "/open/clients/rotate": {
                "post": {
                    "tags": ["catalog"],
                    "summary": "轮换 API Key（新密钥只返回一次，旧密钥立即失效）",
                    "responses": {"200": {"description": "含 apiKey"}},
                }
            },
            "/open/register": {
                "post": {
                    "tags": ["catalog"], "security": [], "summary": "自助开通沙箱 API Key",
                    "responses": {"200": {"description": "含 apiKey，仅一次"}},
                }
            },
            "/open/sdk": {
                "get": {"tags": ["catalog"], "security": [], "summary": "官方 SDK 安装与示例", "responses": {"200": {"description": "OK"}}},
            },
            "/open/me": {
                "get": {"tags": ["catalog"], "summary": "当前密钥档案、用量与默认 Workspace", "responses": {"200": {"description": "OK"}}},
            },
            "/open/usage": {
                "get": {"tags": ["catalog"], "summary": "今日/本月调用与写入行", "responses": {"200": {"description": "OK"}}},
            },
            "/open/workspaces": {
                "get": {"tags": ["catalog"], "summary": "最终客户 Workspace 列表", "responses": {"200": {"description": "OK"}}},
                "post": {"tags": ["catalog"], "summary": "创建 Workspace", "responses": {"200": {"description": "OK"}}},
            },
            "/open/datasources/inspect": {
                "post": {"tags": ["data"], "summary": "探测表/字段/样例行", "responses": {"200": {"description": "tables/columns/sample"}}},
            },
            "/open/jobs/preview": {
                "post": {"tags": ["jobs"], "summary": "抽取样例并按映射预览", "responses": {"200": {"description": "sample/preview"}}},
            },
            "/open/jobs/promote": {
                "post": {
                    "tags": ["jobs"],
                    "summary": "把任务及数据源复制到目标环境（默认 prod）",
                    "responses": {"200": {"description": "新任务"}},
                }
            },
            "/open/status": {
                "get": {"tags": ["catalog"], "security": [], "summary": "服务状态", "responses": {"200": {"description": "OK"}}},
            },
            "/open/errors": {
                "get": {"tags": ["catalog"], "security": [], "summary": "错误码目录", "responses": {"200": {"description": "OK"}}},
            },
            "/open/changelog": {
                "get": {"tags": ["catalog"], "security": [], "summary": "开放能力变更", "responses": {"200": {"description": "OK"}}},
            },
            "/open/sso/launch": {
                "post": {
                    "tags": ["apps"], "summary": "A→中台→B 免登跳转",
                    "responses": {"200": {"description": "{ url }"}},
                }
            },
        },
    }
