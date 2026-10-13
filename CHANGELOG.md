# Changelog

所有版本迭代在此文件记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
版本号采用 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- 私有化离线 License 签名校验（Ed25519），硬上限覆盖数据库配额
- 健康检查端点 `GET /api/open/health`（DB + Redis + 队列 + 版本）
- 结构化 JSON 日志（生产态 ELK/Loki 友好）
- Docker Compose 一键部署（Postgres + Redis + API + Celery + 控制台）
- 数据库备份脚本（pg_dump + retention 清理）
- SDK `check_revocation` 默认开启，踢下线即时生效
- OAuth2 refresh token 轮换，旧 jti 黑名单
- 执行回执 payload 脱敏（password/secret/token 等字段）
- 调度器每 30 秒清理 OAuthState / SsoTicket / 过期会话 / 密码重置 token
- 手动 trigger 配额超限预检 warning

### 修复
- JWT revocation 数据库异常不再静默降级（原返回 False）
- AES decrypt 密钥/密文不匹配时不再返回原密文当明文用
- throttling Redis 挂起加 warning 日志

## [1.5.0] - 2026-09-18

### 新增
- 产品介绍与定价页面（/prointriduce.html），SEO + GEO 结构化数据
- OpenAPI discovery issuer 改为 URL 化，兼容 next-auth / python-social-auth
- OAuth2 authorize 支持未登录浏览器重定向到控制台登录页
- 部署反代统一口径：PUBLIC_BASE_URL + PUBLIC_API_PREFIX 单一来源

## [1.4.0] - 2026-09-01
