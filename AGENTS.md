# 集成中台项目 (Integration Platform)

## 项目概览

企业级集成中台系统，提供统一的身份认证、数据集成、任务调度、监控运维能力。采用前后端分离 + 模块化设计，解决权限孤岛、数据不一致、系统点对点直连等核心痛点。

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4
- **ORM**: Drizzle ORM
- **数据库**: SQLite (开发) / 可切换 PostgreSQL (生产)
- **认证**: JWT (access token + refresh token)
- **加密**: AES-256-CBC (敏感字段加密)
- **队列**: 内存队列 (开发) / 可切换 BullMQ+Redis (生产)
- **限流**: rate-limiter-flexible

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── seed.ts             # 种子数据初始化脚本
├── src/
│   ├── app/                # 页面路由与 API 接口
│   │   ├── api/            # 后端 API Routes
│   │   │   ├── auth/       # 认证接口（登录、刷新、当前用户）
│   │   │   ├── users/      # 用户管理
│   │   │   ├── roles/      # 角色管理
│   │   │   ├── datasources/ # 数据源管理（含测试连接）
│   │   │   ├── jobs/       # 集成任务管理（含触发、启停）
│   │   │   ├── executions/ # 执行历史
│   │   │   ├── dead-letters/ # 死信队列
│   │   │   ├── audit-logs/ # 审计日志
│   │   │   ├── dashboard/  # 仪表盘统计
│   │   │   └── system/     # 系统管理（种子数据）
│   │   ├── login/          # 登录页
│   │   ├── datasources/    # 数据源管理页
│   │   ├── jobs/           # 任务管理页
│   │   ├── executions/     # 执行监控页
│   │   ├── dead-letters/   # 死信队列页
│   │   ├── audit-logs/     # 审计日志页
│   │   └── users/          # 用户管理页
│   ├── components/
│   │   ├── ui/             # Shadcn UI 组件库
│   │   ├── app-sidebar.tsx # 侧边栏导航
│   │   ├── app-layout.tsx  # 后台布局
│   │   └── providers.tsx   # 全局 Provider
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 前端工具库
│   │   ├── utils.ts        # 通用工具函数 (cn)
│   │   ├── api-client.ts   # API 请求封装
│   │   └── auth-context.tsx # 认证上下文
│   └── server/             # 服务端代码
│       ├── db/             # 数据库层
│       │   ├── index.ts    # Drizzle 实例
│       │   └── schema/     # 数据表 Schema
│       │       ├── iam.ts  # IAM 模块（用户、角色、权限、应用）
│       │       ├── datasource.ts # 数据源配置
│       │       ├── integration-job.ts # 集成任务
│       │       ├── job-execution.ts # 执行记录 + 死信队列
│       │       └── audit-log.ts # 审计日志
│       ├── services/       # 业务服务层
│       │   ├── user-service.ts
│       │   ├── datasource-service.ts
│       │   ├── job-service.ts
│       │   ├── field-mapping-engine.ts # 字段映射引擎
│       │   ├── monitor-service.ts
│       │   └── audit-service.ts
│       ├── queue/          # 任务队列
│       │   ├── index.ts    # 队列抽象层
│       │   ├── in-memory-queue.ts # 内存队列实现
│       │   ├── etl-executor.ts # ETL 执行器
│       │   ├── scheduler.ts # 调度器
│       │   └── worker.ts   # Worker 进程
│       ├── utils/          # 服务端工具
│       │   ├── id.ts       # ID 生成器（雪花算法）
│       │   ├── encryption.ts # 加密解密
│       │   ├── password.ts # 密码哈希
│       │   ├── jwt.ts      # JWT 工具
│       │   ├── auth.ts     # 认证中间件
│       │   └── rate-limit.ts # 限流
│       └── seed.ts         # 种子数据
├── data/                   # SQLite 数据库文件
├── drizzle/                # Drizzle 迁移文件
├── drizzle.config.ts       # Drizzle 配置
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖
├── tsconfig.json           # TypeScript 配置
├── DESIGN.md               # 设计规范文档
└── AGENTS.md               # 本文档
```

## 五大核心模块

### 1. IAM 身份认证模块
- JWT 双 Token 认证（access 8h + refresh 7d）
- 用户管理（增删改查、状态管理、密码策略）
- 角色权限（RBAC 模型，角色 → 权限映射表）
- 登录限流（防暴力破解）
- 默认账号：admin / admin123

### 2. 数据源管理模块
- 支持 20+ 种连接器：
  - **关系型数据库**：MySQL、PostgreSQL、Oracle、SQL Server、达梦、人大金仓
  - **NoSQL**：MongoDB、Elasticsearch、Redis
  - **消息队列**：RabbitMQ、Kafka、RocketMQ
  - **API/Webhook**：HTTP API、Webhook
  - **文件/存储**：SFTP、FTP、S3、CSV/Excel
  - **目录服务**：LDAP、Active Directory
  - **身份协议**：SCIM 2.0
  - **企业SaaS**：钉钉、企业微信、飞书、用友 U8 ERP、纷享销客 CRM
- 敏感字段加密存储（密码、secret 等）
- 测试连接功能（新建/编辑时验证连通性）
- 连接器可插拔架构

### 3. 集成任务模块
- 任务配置（源/目标数据源、映射规则、调度策略）
- 字段映射引擎（直接映射、表达式转换、类型转换、默认值）
- 全量 / 增量同步模式（水位线机制）
- 调度类型：手动 / Cron / 事件 / Webhook

### 4. 任务执行引擎
- 队列抽象层（内存队列 / BullMQ 可切换）
- ETL 管道（Extract → Transform → Load）
- 任务执行记录（状态、耗时、处理行数、错误信息）
- 死信队列（失败数据留存、支持重处理、敏感字段自动脱敏）
- 重试机制（可配置次数和间隔）
- 同步决策引擎（主键去重 + Upsert + 冲突解决策略）
- 字段级变更审计（变更前后值完整记录）
- 数据版本快照与回滚能力

### 5. SSO 单点登录模块
- 支持 SAML 2.0、OAuth 2.0 协议
- 应用管理与配置（SP/IdP 元数据）
- SSO 会话管理与审计日志
- SAML ACS 断言消费端点与 IdP Metadata 端点

### 6. 用户同步增强模块
- 5 个预置用户同步模板（通用/HR/AD/钉钉/企微）
- 组织架构同步（部门树 + 用户-部门多对多）
- 主键去重与冲突解决策略（源优先/目标优先/时间优先/人工介入）
- 敏感字段脱敏（10 种规则 + 智能识别）
- 字段级变更审计
- 数据版本快照与回滚

### 7. 监控运维模块
- 仪表盘统计（任务数、执行量、成功率、趋势图）
- 执行历史（分页、筛选、详情查看）
- 死信队列管理（重新处理、忽略）
- 审计日志（所有操作全记录 + 字段变更审计）
- Prometheus 风格指标接口（预留）

## 安全特性

| 特性 | 实现方式 |
|:---|:---|
| 传输加密 | 生产环境部署 HTTPS |
| 敏感数据加密 | AES-256-CBC 加密存储数据源密码等 |
| 密码安全 | bcrypt 哈希 + 强度校验 |
| API 限流 | rate-limiter-flexible（登录每 IP 每分钟 5 次） |
| 操作审计 | 所有增删改操作自动记录审计日志 |
| SQL 注入防护 | Drizzle ORM 参数化查询 |
| 权限控制 | RBAC 细粒度权限校验 |

## 开发命令

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 数据库迁移
pnpm exec drizzle-kit generate
pnpm exec drizzle-kit migrate

# 初始化种子数据
pnpm exec tsx scripts/seed.ts

# 类型检查
pnpm ts-check

# 代码检查
pnpm lint
```

## 默认账号

| 用户名 | 密码 | 角色 |
|:---|:---|:---|
| admin | admin123 | 超级管理员 |

## 接口清单

共 19 个 API 接口：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | /api/auth/login | 登录 |
| POST | /api/auth/refresh | 刷新 Token |
| GET | /api/auth/me | 当前用户信息 |
| GET | /api/users | 用户列表 |
| GET | /api/users/:id | 用户详情 |
| PUT | /api/users/:id | 更新用户 |
| DELETE | /api/users/:id | 删除用户 |
| GET | /api/roles | 角色列表 |
| GET | /api/datasources | 数据源列表 |
| POST | /api/datasources | 创建数据源 |
| GET | /api/datasources/:id | 数据源详情 |
| PUT | /api/datasources/:id | 更新数据源 |
| DELETE | /api/datasources/:id | 删除数据源 |
| POST | /api/datasources/test | 测试连接 |
| GET | /api/jobs | 任务列表 |
| POST | /api/jobs | 创建任务 |
| GET | /api/jobs/:id | 任务详情 |
| PUT | /api/jobs/:id | 更新任务 |
| DELETE | /api/jobs/:id | 删除任务 |
| POST | /api/jobs/trigger | 手动触发执行 |
| POST | /api/jobs/control | 启停任务 |
| GET | /api/executions | 执行历史列表 |
| GET | /api/executions/:id | 执行详情 |
| GET | /api/dead-letters | 死信队列列表 |
| POST | /api/dead-letters | 批量操作（重处理/忽略） |
| GET | /api/audit-logs | 审计日志列表 |
| GET | /api/dashboard/stats | 仪表盘统计 |
| POST | /api/system/seed | 初始化种子数据 |

## 部署说明

- 开发环境：SQLite + 内存队列
- 生产环境：PostgreSQL + BullMQ(Redis) + 多实例部署
- 数据库切换：修改 `src/server/db/index.ts` 中的驱动和连接
- 队列切换：设置 `REDIS_URL` 环境变量并实现 `bullmq-queue.ts`

## 扩展方向

- 工作流编排：引入 Temporal 或自研 DAG 引擎
- 双向同步：增加 source_system 标记防回环
- Webhook 触发：源系统主动推送数据
- 大文件传输：CSV/Parquet 批量传输
- K8s 部署：Helm Chart + 健康检查 + 自动扩缩容
