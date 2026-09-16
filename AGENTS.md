# 集成中台项目 (Integration Platform)

企业级集成中台：身份认证、数据集成、任务调度、SSO、开放 API。控制台与 API 分离。

**现网主路径**：Django REST Framework（`:8000`）提供全部业务 API；Next.js 控制台请求 `NEXT_PUBLIC_API_BASE`（推荐 `http://127.0.0.1:8000/api`）。未设时同源 `/api` 反代到 Django，共用同一套 PostgreSQL。

定位是**服务枢纽**（集成商用 API Key），不是最终用户门户。

## 技术栈

| 层 | 现网 |
|---|---|
| 控制台 | Next.js 16（App Router）+ React 19 + TypeScript 5 + shadcn/ui + Tailwind CSS 4 |
| 业务 API | Django 5 + DRF，JSON **camelCase**，前缀 `/api`（无尾斜杠） |
| 数据库 | PostgreSQL（必须 `DATABASE_URL=postgres://...`） |
| 认证 | JWT access 8h + refresh 7d |
| 加密 | AES-256-CBC（数据源密码等） |
| 队列 | 开发内存队列 + 进程内 APScheduler；生产 `QUEUE_BACKEND=celery` + Redis |
| 指标 | `GET /api/metrics`（`prometheus_client`，控制台仪表盘也展示） |
| 开放 SDK | `sdk/python`、`sdk/typescript` |

控制台不带本地业务库。生产队列是 Celery，不是 BullMQ。

## 目录结构

```
├── backend/                 # 现网 API（Django）
│   ├── config/              # settings / urls / wsgi
│   ├── iam/                 # 登录、用户、角色、RBAC
│   ├── datasources/         # 数据源、连接器运行时
│   ├── jobs/                # 集成任务、映射校验
│   ├── executions/          # ETL、DAG、死信、字段审计、快照、队列
│   ├── sso/                 # 应用、OAuth2、SAML、会话
│   ├── org_sync/            # 部门树、人-部门、同步模板
│   ├── audit/               # 操作审计
│   ├── monitor/             # 仪表盘、Prometheus
│   ├── open_api/            # API Key 门面、OpenAPI、用量
│   └── core/                # JWT、加密、鉴权、限流
├── src/                     # Next 控制台
│   ├── app/                 # 页面（含 org / sso-logs / open / apps）
│   ├── components/          # 布局、侧栏、Scope 切换
│   └── lib/api-client.ts    # 前端请求封装
├── sdk/                     # 集成商 Python / TypeScript SDK
├── scripts/                 # 控制台启动脚本（默认端口 5000）
├── DESIGN.md                # UI 设计规范
└── AGENTS.md                # 本文档
```

## 控制台页面

| 路径 | 说明 |
|---|---|
| `/` | 仪表盘（统计、趋势、指标） |
| `/datasources` | 数据源 |
| `/jobs` | 集成任务（探测、预览、拉通讯录、组织树弹窗、DAG 画布） |
| `/org` | 组织架构树（按任务） |
| `/executions` | 执行记录 + DAG 编排步骤 |
| `/dead-letters` | 死信（重处理 / 忽略 / 改字段再落库） |
| `/apps`、`/apps/manage` | 应用门户 / 应用管理 |
| `/open` | 开放服务（发 Key、用量） |
| `/sso-logs` | SSO 登录日志 + 活跃会话吊销 |
| `/users` | 用户与角色权限 |
| `/audit-logs` | 操作审计 + 字段变更 |
| 顶栏 | 环境 / Workspace 切换（`X-Environment`、`X-Workspace-Id`） |

默认账号：`admin` / `admin123`（种子密码仍满足策略，登录只比对哈希）。

## 核心能力（已落地）

### IAM
- JWT 双 Token；登录限流（每 IP 每分钟 5 次失败）
- 用户 CRUD、状态、改密
- 角色 CRUD + 权限维护（RBAC）
- 创建/改密：至少 8 位、字母+数字、不能等于用户名、弱密码表；登录不套该策略

### 数据源与连接器
目录 20+ 种均可登记、测连（无专用协议测试的类型**不会**仅因端口开着就报成功）。

真实 Extract/Load：HTTP、Webhook（可作目标或带 records 推数）、MySQL/PostgreSQL、Oracle/SQL Server/达梦/金仓（需驱动）、MongoDB、Elasticsearch、SFTP/FTP/S3、CSV/Excel、飞书/用友/纷享/SCIM、Kafka/RabbitMQ/Redis/RocketMQ。

钉钉 / 企微 / LDAP / AD：可作 ETL **抽取源**（`table=users|departments`）或「拉通讯录」，**不能**当写入目标。可选驱动见 `backend/requirements-connectors.txt`。

### 集成任务
- 映射：直接 / 类型转换 / 默认值 / 自定义表达式（`params.expression`）
- 全量 / 增量（SQL、Mongo、ES、HTTP 等按水位过滤；部分 SaaS/MQ 可能整批再本地滤）
- 调度：手动 / Cron / 事件名 / Webhook
- 冲突：源优先 / 目标优先 / 时间优先 / 进死信后人工决裁
- `dagSteps` 多步（`dependsOn`）；任务页画布编排，运行后在执行监控看步骤状态
- 双向防回环（`_ip_origin` / hops）；可配反向
- 失败重试次数/间隔、回执 `callbackUrl`、失败告警
- 环境 `dev|staging|prod`、Workspace、所属集成商（Key 可见代配资产）

### 执行引擎
- ETL：Extract → Transform → Load；空跑 0 行不当成功
- 执行记录、死信脱敏、快照回滚、字段变更审计
- DAG：`GET /api/workflows`
- 开发内存队列；生产 Celery

### SSO
- JWT / Ticket、A→中台→B 换票（`/api/sso/launch`）
- OAuth2 授权码 + PKCE；也可作授权服务器 `/api/oauth/*`
- SAML：须配置 IdP 证书，ACS **校验 XML-DSig**，未签名断言拒绝
- 会话列表 / 吊销；登录审计

### 组织与用户同步
- 5 个预置模板；拉通讯录写部门 + 人-部门
- `GET /api/org-departments?jobId=&tree=true`
- 脱敏：多种规则 + 按字段名智能识别；任务上可勾选

### 开放服务
- 自助 `POST /api/open/register` 或控制台发 Key
- Key 看见：自己创建的 **或** `client_id` 指派的资源
- OpenAPI：`/api/open/openapi.json`、`/api/open/docs`
- 入站 Webhook、ingest、回执、幂等键 `Idempotency-Key`

### 监控
- 仪表盘统计与趋势
- `GET /api/metrics` Prometheus 文本
- 操作审计 + 字段变更页

## 安全

| 特性 | 现网 |
|---|---|
| 传输加密 | 生产部署 HTTPS |
| 敏感字段 | AES-256-CBC |
| 密码 | bcrypt；创建/改密强度校验 |
| 登录限流 | 每 IP 每分钟 5 次失败 |
| 审计 | 增删改记操作日志 |
| 注入 | Django ORM 参数化 |
| 权限 | RBAC |
| SAML | 强制 IdP 证书 + 签名 |

## 开发命令

```bash
# 后端（现网 API）
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py seed
python manage.py runserver 8000

# 控制台（另开终端，项目根）
# Windows PowerShell:
$env:NEXT_PUBLIC_API_BASE="http://127.0.0.1:8000/api"
$env:PORT="5004"
pnpm install
pnpm exec tsx watch src/server.ts
```

脚本 `pnpm dev` 默认端口 **5000**。本机常用 **5004** 以免和其它服务冲突。Django **不要**再绑到 8000 以外的第二个业务实例抢端口。

生产队列：

```bash
# backend/.env
QUEUE_BACKEND=celery
REDIS_URL=redis://127.0.0.1:6379/0
celery -A executions.queue.celery_app worker -l info
```

Oracle / SQL Server / 达梦 / SFTP 等：`pip install -r requirements-connectors.txt`。

## 接口约定

- 前缀 `/api`，无尾斜杠
- JWT：`Authorization: Bearer <accessToken>`
- API Key：`X-Api-Key: ipk_...` 或 `Authorization: Bearer ipk_...`
- 分页 `{ items, total, page, pageSize }`
- 错误 `{ error: "消息" }`
- 环境：`X-Environment` 或查询 `environment`；Workspace：`X-Workspace-Id`

完整 Open 门面见 `backend/README.md` 与 `/api/open/docs`。控制台常用：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/login | 登录 |
| POST | /api/auth/refresh | 刷新 |
| POST | /api/auth/logout | 登出 |
| GET | /api/auth/me | 当前用户 |
| GET/POST | /api/users | 用户列表 / 创建 |
| GET/PUT/DELETE | /api/users/:id | 用户详情 |
| GET/POST | /api/roles | 角色列表 / 创建 |
| PUT/DELETE | /api/roles/:id | 更新 / 删除角色 |
| GET/POST | /api/datasources | 数据源 |
| POST | /api/datasources/test | 测连 |
| POST | /api/datasources/inspect | 探测表/字段 |
| GET/POST | /api/jobs | 任务 |
| POST | /api/jobs/preview | 映射预览 |
| POST | /api/jobs/trigger | 触发 |
| POST | /api/jobs/control | 启停 |
| GET | /api/executions | 执行历史 |
| GET | /api/workflows | DAG 运行 |
| GET | /api/field-audit | 字段变更 |
| GET | /api/org-departments | 部门树 |
| GET/POST | /api/dead-letters | 死信；resolve 可改字段再写 |
| GET | /api/version-snapshots | 快照 |
| GET | /api/audit-logs | 操作审计 |
| GET | /api/dashboard/stats | 仪表盘 |
| GET | /api/metrics | Prometheus |
| GET/DELETE | /api/sso/sessions | SSO 会话 |
| GET | /api/sso/logs | SSO 审计 |

## 部署

- 开发：PostgreSQL + 内存队列 + APScheduler 租约（避免多进程双发，仍不是分布式调度器）
- 生产：PostgreSQL + Celery/Redis；改 `DJANGO_SECRET_KEY` / `JWT_SECRET` / `ENCRYPTION_KEY`
- 邮件告警需 `SMTP_HOST`
- 控制台务必设置 `NEXT_PUBLIC_API_BASE` 指向 Django

## 扩展方向（未做，不要写成已有）

- Temporal 工作流引擎（现网是 DAG 画布 + 步骤监控）
- CDC / binlog（增量主要是水位线）
- Helm / K8s 清单与自动扩缩容
- 大文件 Parquet 批量传输
- 白标嵌入页、对外 SLA 状态页、按行计费账单
