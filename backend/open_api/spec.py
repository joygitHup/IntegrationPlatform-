"""OpenAPI 3.0：仅覆盖 /api/open/* 供集成商生成客户端。"""
from __future__ import annotations


def _api_base() -> str:
    from core.public_urls import api_base_url

    return api_base_url()


def build_openapi() -> dict:
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "集成中台开放服务",
            "version": "1.1.0",
            "description": (
                "中台对外只提供服务。用 API Key 接入应用、数据、消息与身份。\n\n"
                "鉴权：`X-Api-Key: ipk_...` 或 `Authorization: Bearer ipk_...`。\n"
                "密钥按客户端隔离资源；可配置 IP 白名单与每分钟限流。\n"
                "目录、连接器、模板、本规范无需密钥。\n\n"
                "## 白标嵌入页\n\n"
                "集成商可以把平台的 SLA 状态卡、用量进度条等轻量页面嵌到自己的控制台，"
                "终端客户看到的是集成商的品牌（logo / 公司名 / 主色）。\n\n"
                "**签名 token 算法**（集成商需在自己后端实现）：\n\n"
                "```python\n"
                "import hmac, hashlib, time\n"
                "client_id = 'ic_xxxxx'\n"
                "embed_token = '48-hex-chars'\n"
                "ts = str(int(time.time()))\n"
                "sig = hmac.new(\n"
                "    embed_token.encode(),\n"
                "    f'{client_id}.{ts}'.encode(),\n"
                "    hashlib.sha256,\n"
                ").hexdigest()\n"
                "token = f'{ts}.{sig}'\n"
                "```\n\n"
                "**服务端验证规则**：\n"
                "- 用 HMAC-SHA256 在服务端重算签名（key = client.embed_token）\n"
                "- 用 constant-time 比较（防时序攻击）\n"
                "- 时间戳与服务端相差 <= 300 秒（5 分钟）\n"
                "- embed_token 由平台管理员通过 `POST /api/embed/token` 重置\n"
                "- 重置后旧 embed_token 仍有 5 分钟宽限期（轮换不断服），新 token 立即生效\n"
                "- iframe 每次加载生成新 token，不要缓存超过 5 分钟\n"
                "- 配置了 `embed_allowed_origins` 白名单时，请求必须带匹配的 Origin/Referer，否则 403\n"
                "- 嵌入页按 IP 限流 120 次 / 分钟，超限返回 429；响应带 `Cache-Control: no-store`\n\n"
                "嵌入页面：\n"
                "- `GET /api/embed/sla?clientId=xxx&token=yyy` — SLA 状态卡\n"
                "- `GET /api/embed/usage?clientId=xxx&token=yyy` — 用量进度条\n"
                "- 追加 `&output=html` 返回完整 HTML 文档（iframe-ready，含白标配色与 XSS 转义）\n"
                "- `GET /api/branding?clientId=xxx` — 白标配置（匿名）；`PUT /api/branding` — 更新白标（需 API Key/JWT）\n\n"
                "## 按行计费账单\n\n"
                "平台每月 1 号 00:10 自动生成上月账单；集成商可手动重算或预览金额：\n\n"
                "- `GET /api/billing/plans` — 计费套餐列表\n"
                "- `POST /api/billing/plans` — 创建套餐（一个 client 一个套餐，重复创建返回 409）\n"
                "- `PUT /api/billing/plans/{id}` — 更新套餐（pricePerRow / monthlyBaseFee / taxRate 等）\n"
                "- `DELETE /api/billing/plans/{id}` — 归档套餐（不物理删除，历史账单口径保留）\n"
                "- `GET /api/invoices?month=2026-09` — 月度账单列表\n"
                "- `POST /api/invoices { action: 'generate', month, clientId }` — 触发生成\n"
                "- `POST /api/invoices { action: 'preview', clientId }` — 不落库只预览\n"
                "- `POST /api/invoices { action: 'pay', invoiceId }` — 标记已支付（幂等；已支付再调用不报错）\n"
                "- `POST /api/invoices { action: 'void', invoiceId, reason }` — 作废账单（已支付账单不可作废，返回 400）\n"
                "- `GET /api/invoices/{id}/pdf` — 下载账单 PDF（列表里的 `pdfUrl` 为绝对地址）\n"
                "- 已签发 / 已支付账单不会被自动重算覆盖（防止历史数据被篡改）\n"
                "- 账单接口需 API Key 或 JWT；`month` 非法格式返回 400；跨租户操作返回 403\n"
                "- 套餐 `effectiveFrom` / `effectiveTo` 不在账期内时自动跳过，不生成账单\n\n"
                "## 对外 SLA 状态\n\n"
                "`GET /api/status?days=30&clientId=xxx` 返回 30 天 SLA：平台整体或某 client 专属。\n"
                "`clientId` 为可选参数：平台账号可直接查；集成商只能用 JWT 查自己，或用 embed token 查询。\n"
                "匿名请求带 `clientId` 且无有效 embed token 返回 403（防枚举）。\n"
                "公开响应不包含内部任务名、数据源、密钥与原始错误信息（仅聚合时长 / 影响任务数）。\n"
                "端点按 IP 限流 120 次 / 分钟（429），结果缓存 60 秒，响应头 `Cache-Control: no-store`。"
            ),
        },
        "servers": [
            # 对外绝对地址：反代后集成商据此生成客户端，不受内网 Host 影响
            {"url": _api_base(), "description": "对外地址（PUBLIC_BASE_URL + PUBLIC_API_PREFIX）"},
            {"url": "/api", "description": "同源相对路径（兼容）"},
        ],
        "tags": [
            {"name": "catalog", "description": "能力目录"},
            {"name": "apps", "description": "应用集成"},
            {"name": "data", "description": "数据集成"},
            {"name": "jobs", "description": "任务与执行"},
            {"name": "identity", "description": "身份拉取"},
            {"name": "hooks", "description": "入站 Webhook"},
            {"name": "billing", "description": "按行计费与账单"},
            {"name": "sla", "description": "SLA 可用性状态"},
            {"name": "embed", "description": "白标嵌入页（签名 token）"},
        ],
        "components": {
            "securitySchemes": {
                "ApiKeyHeader": {"type": "apiKey", "in": "header", "name": "X-Api-Key"},
                "ApiKeyBearer": {"type": "http", "scheme": "bearer", "bearerFormat": "ipk"},
                "EmbedToken": {
                    "type": "apiKey",
                    "in": "query",
                    "name": "token",
                    "description": (
                        "白标嵌入页签名 token（非 JWT）。"
                        "格式 `{unix_ts}.{hmac_sha256(client_id.ts, embed_token)}`，5 分钟有效。"
                        "详见本规范 '白标嵌入页' 章节。"
                    ),
                },
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
            # ====== 按行计费 ======
            "/billing/plans": {
                "get": {
                    "tags": ["billing"],
                    "summary": "计费套餐列表（平台看全部 / 客户只看自己）",
                    "security": [{"ApiKeyHeader": []}],
                    "responses": {"200": {"description": "BillingPlan 数组"}},
                },
                "post": {
                    "tags": ["billing"],
                    "summary": "创建 / 更新计费套餐",
                    "security": [{"ApiKeyHeader": []}],
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "required": ["effectiveFrom"],
                        "properties": {
                            "clientId": {"type": "string", "description": "平台可不传（自动取调用者 client）"},
                            "pricePerRow": {"type": "number", "default": 0},
                            "pricePerApiCall": {"type": "number", "default": 0},
                            "monthlyBaseFee": {"type": "number", "default": 0},
                            "freeRowsPerMonth": {"type": "integer", "default": 0},
                            "freeApiCallsPerMonth": {"type": "integer", "default": 0},
                            "currency": {"type": "string", "default": "CNY"},
                            "taxRate": {"type": "number", "default": 0.06},
                            "effectiveFrom": {"type": "string", "format": "date"},
                            "effectiveTo": {"type": "string", "format": "date"},
                            "status": {"type": "string", "enum": ["active", "suspended", "archived"]},
                            "note": {"type": "string"},
                        },
                    }}}},
                    "responses": {"200": {"description": "{ id, message }"}},
                },
            },
            "/billing/plans/{planId}": {
                "put": {
                    "tags": ["billing"],
                    "summary": "更新计费套餐",
                    "security": [{"ApiKeyHeader": []}],
                    "parameters": [
                        {"name": "planId", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {
                            "pricePerRow": {"type": "number"},
                            "pricePerApiCall": {"type": "number"},
                            "monthlyBaseFee": {"type": "number"},
                            "freeRowsPerMonth": {"type": "integer"},
                            "freeApiCallsPerMonth": {"type": "integer"},
                            "currency": {"type": "string"},
                            "taxRate": {"type": "number"},
                            "effectiveFrom": {"type": "string", "format": "date"},
                            "effectiveTo": {"type": "string", "format": "date"},
                            "status": {"type": "string", "enum": ["active", "suspended", "archived"]},
                            "note": {"type": "string"},
                        },
                    }}}},
                    "responses": {"200": {"description": "{ id, message }"}, "403": {"description": "跨租户修改"}, "404": {"description": "套餐不存在"}},
                },
                "delete": {
                    "tags": ["billing"],
                    "summary": "归档计费套餐（软删除，保留历史账单口径）",
                    "security": [{"ApiKeyHeader": []}],
                    "parameters": [
                        {"name": "planId", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {"200": {"description": "{ id, status, message }"}, "403": {"description": "跨租户归档"}, "404": {"description": "套餐不存在"}},
                },
            },
            "/invoices": {
                "get": {
                    "tags": ["billing"],
                    "summary": "月度账单列表",
                    "security": [{"ApiKeyHeader": []}],
                    "parameters": [
                        {"name": "month", "in": "query", "schema": {"type": "string", "example": "2026-09"}},
                    ],
                    "responses": {
                        "200": {"description": "Invoice 数组；pdfUrl 为绝对地址"},
                        "403": {"description": "跨租户访问"},
                    },
                },
                "post": {
                    "tags": ["billing"],
                    "summary": "触发生成 / 预览账单金额",
                    "security": [{"ApiKeyHeader": []}],
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "required": ["action"],
                        "properties": {
                            "action": {"type": "string", "enum": ["generate", "preview", "pay", "void"]},
                            "month": {"type": "string", "example": "2026-09", "description": "YYYY-MM，非法格式返回 400"},
                            "clientId": {"type": "string", "description": "平台账号可指定；集成商自动忽略并用自己的"},
                            "invoiceId": {"type": "string", "description": "action=pay / void 时必填"},
                            "reason": {"type": "string", "description": "action=void 时填写作废原因"},
                        },
                    }}}},
                    "responses": {
                        "200": {"description": "generate → { generated, invoices }；preview → bill dict；pay → invoice；void → invoice"},
                        "400": {"description": "已支付账单不可作废 / 参数缺失 / month 格式非法"},
                        "403": {"description": "跨租户操作"},
                        "404": {"description": "账单或有效套餐不存在"},
                    },
                },
            },
            "/invoices/{invoiceId}/pdf": {
                "get": {
                    "tags": ["billing"],
                    "summary": "下载账单 PDF",
                    "security": [{"ApiKeyHeader": []}],
                    "parameters": [
                        {"name": "invoiceId", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {
                        "200": {"description": "application/pdf 字节流"},
                        "403": {"description": "跨租户访问"},
                        "404": {"description": "账单不存在"},
                    },
                }
            },
            # ====== 对外 SLA ======
            "/status": {
                "get": {
                    "tags": ["sla"],
                    "summary": "平台 / Client SLA 状态（平台账号匿名可查；带 clientId 需 JWT 或 embed token）",
                    "parameters": [
                        {"name": "days", "in": "query", "schema": {"type": "integer", "default": 30}},
                        {"name": "clientId", "in": "query", "schema": {"type": "string"}, "description": "可选；不传=平台整体。带此参数需登录或提供 embed token"},
                        {"name": "token", "in": "query", "schema": {"type": "string"}, "description": "embed token（匿名查某个 clientId 时必须）"},
                    ],
                    "responses": {
                        "200": {"description": "{ status, sla, infrastructure, uptime30d, history, successRate, totalExecutions, failures, outages, updatedAt }；outages 已脱敏"},
                        "403": {"description": "匿名访问某个 clientId 且无有效 embed token"},
                        "429": {"description": "IP 限流 120 次 / 分钟"},
                    },
                }
            },
            # ====== 白标嵌入页 ======
            "/branding": {
                "get": {
                    "tags": ["embed"],
                    "security": [],
                    "summary": "获取某个 client 的白标配置（logo / 公司名 / 颜色）",
                    "parameters": [
                        {"name": "clientId", "in": "query", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {"200": {"description": "{ companyName, productName, logoUrl, primaryColor, secondaryColor }"}},
                },
                "put": {
                    "tags": ["embed"],
                    "summary": "更新某个 client 的白标配置（需 API Key / JWT）",
                    "security": [{"ApiKeyHeader": []}],
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {
                            "clientId": {"type": "string", "description": "集成商可不传（自动取调用者 client）"},
                            "companyName": {"type": "string"},
                            "productName": {"type": "string"},
                            "logoUrl": {"type": "string"},
                            "primaryColor": {"type": "string", "example": "#1D4ED8"},
                            "secondaryColor": {"type": "string"},
                            "allowedOrigins": {"type": "array", "items": {"type": "string"}},
                        },
                    }}}},
                    "responses": {"200": {"description": "更新后的白标配置"}, "403": {"description": "跨租户修改"}},
                },
            },
            "/embed/token": {
                "post": {
                    "tags": ["embed"],
                    "summary": "重置 embed_token + 返回 5 分钟有效的示例签名（集成商需调用一次来拿到 embed_token）",
                    "security": [{"ApiKeyHeader": []}],
                    "requestBody": {"content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {"clientId": {"type": "string"}},
                    }}}},
                    "responses": {"200": {"description": "{ embedToken, exampleToken, validMinutes, usage }"}},
                }
            },
            "/embed/sla": {
                "get": {
                    "tags": ["embed"],
                    "security": [{"EmbedToken": []}],
                    "summary": "嵌入页 SLA 卡片（iframe 用）",
                    "parameters": [
                        {"name": "clientId", "in": "query", "required": True, "schema": {"type": "string"}},
                        {"name": "token", "in": "query", "required": True, "schema": {"type": "string"}, "description": "签名 token: `{unix_ts}.{hmac_sha256(client_id.ts, embed_token)}`"},
                        {"name": "output", "in": "query", "schema": {"type": "string", "enum": ["json", "html"]}, "description": "html=返回 iframe-ready HTML 文档；默认 json"},
                    ],
                    "responses": {
                        "200": {"description": "{ branding, sla } 或 HTML 文档"},
                        "403": {"description": "签名无效 / 过期 / Origin 不在白名单"},
                        "429": {"description": "IP 限流 120 次 / 分钟"},
                    },
                }
            },
            "/embed/usage": {
                "get": {
                    "tags": ["embed"],
                    "security": [{"EmbedToken": []}],
                    "summary": "嵌入页用量进度条（iframe 用）",
                    "parameters": [
                        {"name": "clientId", "in": "query", "required": True, "schema": {"type": "string"}},
                        {"name": "token", "in": "query", "required": True, "schema": {"type": "string"}},
                        {"name": "output", "in": "query", "schema": {"type": "string", "enum": ["json", "html"]}, "description": "html=返回 iframe-ready HTML 文档；默认 json"},
                    ],
                    "responses": {
                        "200": {"description": "{ rowsWritten, rowsLimit, rowsPercent, apiCalls, apiCallsLimit, apiCallsPercent, period } 或 HTML 文档"},
                        "403": {"description": "签名无效 / 过期 / Origin 不在白名单"},
                        "429": {"description": "IP 限流 120 次 / 分钟"},
                    },
                }
            },
        },
    }
