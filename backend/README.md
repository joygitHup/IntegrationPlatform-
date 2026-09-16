# 集成中台 · Python 后端 (Django REST Framework)

与前端 `src/lib/api-client.ts` 路径、字段（camelCase）及错误体 `{ error }` 对齐的独立后端。

## 模块划分

| 包 | 职责 |
|---|---|
| `iam/` | 登录 / JWT / 用户 / 角色 / RBAC / 种子数据 |
| `datasources/` | 数据源 CRUD、连通性测试、20+ 连接器注册表 |
| `jobs/` | 集成任务、字段映射引擎 |
| `executions/` | 执行历史、死信、字段审计、快照、DAG、ETL、内存队列 / Celery、Cron |
| `sso/` | 应用纳管、JWT/Ticket/OAuth2/SAML、会话与审计 |
| `org_sync/` | 部门树、组织同步、用户同步模板 |
| `audit/` | 操作审计 |
| `monitor/` | 仪表盘统计、Prometheus `/api/metrics` |
| `open_api/` | 对外开放服务：能力目录、API Key、应用 / 数据 / 任务门面 |
| `core/` | ID、AES 加密、JWT、分页、鉴权、限流 |

## 快速启动

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py makemigrations
python manage.py migrate
python manage.py seed
python manage.py runserver 8000
```

默认账号：`admin` / `admin123`

## 对接控制台

现网控制台应指向本服务。未设 `NEXT_PUBLIC_API_BASE` 时，控制台同源 `/api` 会反代到本服务：

```bash
# 项目根目录。Windows PowerShell：
$env:NEXT_PUBLIC_API_BASE="http://127.0.0.1:8000/api"
$env:PORT="5004"
pnpm exec tsx watch src/server.ts
```

CORS 默认包含 `localhost:3000` / `5004`（见 `.env.example`）。控制台页面、环境切换、组织树 / 字段审计 / SSO 会话 / DAG 监控说明见仓库根目录 `AGENTS.md`。

## 接口约定

- 前缀：`/api`，无尾斜杠
- 鉴权：`Authorization: Bearer <accessToken>`
- Token：access 8h + refresh 7d，payload 含 `userId` / `username` / `roleId` / `type`
- 分页：`{ items, total, page, pageSize }`
- 错误：`{ error: "消息" }`
- JSON 字段：camelCase（`displayName`、`roleId`、`sourceDatasourceId` 等）

## 开放服务（集成商）

中台对外只提供服务。集成商不走控制台完成业务，而是用 API Key 接入应用、数据、消息与身份。

鉴权：`X-Api-Key: ipk_...` 或 `Authorization: Bearer ipk_...`  
密钥可 `POST /api/open/register` 自助开通沙箱，或由控制台「开放服务」发放。完整值只返回一次。  
运营在控制台创建数据源 / 任务 / 应用时选择「所属集成商」，对方 Key 即可看见并调用（不必再配一遍）。

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | /api/open/register | 自助开通沙箱 API Key | 公开 |
| GET | /api/open/sdk | 官方 Python / TypeScript SDK | 公开 |
| GET | /api/open/catalog | 能力目录（应用 / 数据 / 消息 / 身份） | 公开 |
| GET | /api/open/openapi.json | OpenAPI 3.0 规范 | 公开 |
| GET | /api/open/docs | Swagger UI | 公开 |
| GET | /api/open/connectors | 连接器与配置 Schema | 公开 |
| GET | /api/open/templates | 用户同步模板 | 公开 |
| GET/POST | /api/open/apps | 应用列表 / 登记应用 | API Key |
| GET/POST | /api/open/datasources | 数据源列表 / 登记 | API Key |
| POST | /api/open/datasources/test | 测试连通 | API Key |
| GET/POST | /api/open/jobs | 任务列表 / 创建 | API Key |
| POST | /api/open/jobs/trigger | 从源抽取并写入目标 | API Key |
| POST | /api/open/jobs/ingest | 推送数据或触发抽取 | API Key |
| POST | /api/open/jobs/rollback | 快照回滚（`execute: true` 真正写入） | API Key |
| POST | /api/open/identity/pull | 钉钉 / 企微 / AD 拉取通讯录 | API Key |
| POST | /api/open/hooks/{code} | 源系统入站 Webhook | Secret 或 API Key |
| GET | /api/open/executions | 执行记录 | API Key |
| POST | /api/open/sso/launch | A→中台→B 免登跳转 | API Key |
| GET/POST/PUT/DELETE | /api/open/clients | 发放 / 更新 / 吊销集成凭证 | 控制台 JWT |
| POST | /api/open/clients/rotate | 轮换 API Key | JWT 或当前 Key |

API Key 能看见 **本凭证创建的** 以及 **控制台指派给该密钥的** 应用、数据源、任务与执行记录。未指派的控制台资产对 Key 不可见。凭证可配 IP 白名单、每分钟限流、失败告警邮箱/Webhook。

真实读写：HTTP、MySQL、PostgreSQL、Oracle/SQL Server/达梦/金仓（需驱动）、MongoDB、Elasticsearch、SFTP/FTP/S3、CSV/Excel、飞书/用友/纷享/SCIM、Kafka/RabbitMQ/Redis/RocketMQ。钉钉/企微/AD/LDAP 可作为 ETL **抽取源**（`table=users|departments`），不能当写入目标。Webhook 可作写入目标。可选驱动见 `requirements-connectors.txt`。任务可配 DAG 多步（`dagSteps` + `dependsOn`）、双向同步防回环（`_ip_origin` / hops）、失败告警与快照回滚。

官方 SDK：`pip install -e sdk/python` 或 `sdk/typescript`。

OAuth2：`GET /api/sso/oauth2/{appId}/authorize` 走授权码 + PKCE，callback 换票并拉 userinfo。平台也可作为授权服务器：`/api/oauth/authorize`、`/api/oauth/token`、`/api/oauth/userinfo`。

SAML：HTTP-Redirect AuthnRequest。ACS 必须配置 IdP 证书并校验 XML-DSig（未签名断言拒绝），同时校验 InResponseTo / Audience / 有效期后建会话。`GET /api/sso/saml/metadata/{appId}` 输出 SP 元数据。会话：`GET/DELETE /api/sso/sessions`。

组织：`GET /api/org-departments?jobId=&tree=true`（拉通讯录会写部门与人-部门）。字段变更：`GET /api/field-audit`。DAG 运行：`GET /api/workflows`。

指标：`GET /api/metrics`（Prometheus，需 `prometheus_client`，控制台仪表盘同步展示）。生产队列：`QUEUE_BACKEND=celery` + `REDIS_URL`，worker：`celery -A executions.queue.celery_app worker -l info`。环境：`ENVIRONMENT=dev|staging|prod`，请求头 `X-Environment` / `X-Workspace-Id`。

跨系统免登也可直接使用 `GET /api/sso/launch?from=&to=&token=`（来源系统用自己的 `secretKey` 签发短时 JWT）。

## 生产建议

- 必须配置 `DATABASE_URL=postgres://...`（仅 PostgreSQL）
- `QUEUE_BACKEND=celery` + Redis 替换内存队列
- 修改 `DJANGO_SECRET_KEY` / `JWT_SECRET` / `ENCRYPTION_KEY`
- 配置 `SMTP_HOST` 后任务失败才会发邮件告警
- 连接器按需 `pip install -r requirements-connectors.txt`（Oracle / SQL Server / Mongo / SFTP / S3 / LDAP / Excel 等）
