import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// 应用表 - 纳管所有可单点登录的外部系统
// ============================================================
export const applications = sqliteTable(
  'sys_applications',
  {
    id: text('id').primaryKey(),
    name: text('name', { length: 128 }).notNull(),
    code: text('code', { length: 64 }).notNull().unique(),
    description: text('description', { length: 500 }),
    icon: text('icon', { length: 255 }),
    category: text('category', { length: 32 }).notNull().default('business'),
    // 登录方式: jwt / ticket / oauth2 / saml / form_based
    loginType: text('login_type', { length: 32 }).notNull().default('jwt'),
    // 目标系统配置
    loginUrl: text('login_url', { length: 500 }),
    logoutUrl: text('logout_url', { length: 500 }),
    callbackUrl: text('callback_url', { length: 500 }),
    // 加密密钥/共享密钥（AES 加密存储）
    secretKey: text('secret_key', { length: 500 }),
    // 详细配置（JSON）- 根据 loginType 不同结构不同
    settings: text('settings', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    // JWT 配置
    jwtAlgorithm: text('jwt_algorithm', { length: 16 }).default('HS256'),
    jwtExpiresIn: integer('jwt_expires_in').notNull().default(30), // 秒
    // Ticket 配置
    ticketExpiresIn: integer('ticket_expires_in').notNull().default(60), // 秒
    // OAuth2 配置
    oauthClientId: text('oauth_client_id', { length: 255 }),
    oauthClientSecret: text('oauth_client_secret', { length: 500 }), // 加密存储
    oauthAuthUrl: text('oauth_auth_url', { length: 500 }),
    oauthTokenUrl: text('oauth_token_url', { length: 500 }),
    oauthUserInfoUrl: text('oauth_userinfo_url', { length: 500 }),
    oauthScope: text('oauth_scope', { length: 255 }),
    // SAML 配置
    samlIdpMetadataUrl: text('saml_idp_metadata_url', { length: 500 }),
    samlSpEntityId: text('saml_sp_entity_id', { length: 255 }),
    samlCert: text('saml_cert', { length: 2000 }),
    // 账号映射方式: same_username / email / manual / attribute
    accountMapping: text('account_mapping', { length: 32 }).notNull().default('same_username'),
    mappingAttribute: text('mapping_attribute', { length: 64 }), // 属性映射时的字段名
    // 安全策略
    ipWhitelistEnabled: integer('ip_whitelist_enabled', { mode: 'boolean' }).notNull().default(false),
    ipWhitelist: text('ip_whitelist', { mode: 'json' }).$type<string[]>().default([]),
    requireMfa: integer('require_mfa', { mode: 'boolean' }).notNull().default(false),
    // 展示设置
    sortOrder: integer('sort_order').notNull().default(0),
    visible: integer('visible', { mode: 'boolean' }).notNull().default(true),
    // 状态
    status: text('status', { length: 16 }).notNull().default('active'), // active / disabled / maintenance
    createdBy: text('created_by', { length: 32 }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxCode: index('idx_apps_code').on(table.code),
    idxCategory: index('idx_apps_category').on(table.category),
    idxStatus: index('idx_apps_status').on(table.status),
  }),
);

// ============================================================
// 用户-应用绑定表 - 用户在目标系统的账号信息
// ============================================================
export const userAppBindings = sqliteTable(
  'sys_user_app_bindings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id', { length: 32 }).notNull(),
    appId: text('app_id', { length: 32 }).notNull(),
    // 目标系统中的用户标识
    externalUserId: text('external_user_id', { length: 128 }),
    externalUsername: text('external_username', { length: 128 }),
    // 加密存储的凭据（密码、token 等）
    encryptedCredentials: text('encrypted_credentials', { length: 2000 }),
    // 绑定状态
    status: text('status', { length: 16 }).notNull().default('active'), // active / inactive / pending
    lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
    loginCount: integer('login_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxUserApp: index('idx_user_app').on(table.userId, table.appId),
    idxApp: index('idx_binding_app').on(table.appId),
  }),
);

// ============================================================
// SSO Ticket 表 - 一次性登录票据
// ============================================================
export const ssoTickets = sqliteTable(
  'sys_sso_tickets',
  {
    id: text('id').primaryKey(),
    ticket: text('ticket', { length: 64 }).notNull().unique(),
    appId: text('app_id', { length: 32 }).notNull(),
    userId: text('user_id', { length: 32 }).notNull(),
    // Ticket 携带的用户信息快照
    userInfo: text('user_info', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    // 状态
    status: text('status', { length: 16 }).notNull().default('pending'), // pending / used / expired / revoked
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    // 请求来源
    ip: text('ip', { length: 64 }),
    userAgent: text('user_agent', { length: 500 }),
    // 目标系统回调记录
    consumedIp: text('consumed_ip', { length: 64 }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxTicket: index('idx_sso_ticket').on(table.ticket),
    idxAppUser: index('idx_sso_app_user').on(table.appId, table.userId),
    idxExpiresAt: index('idx_sso_expires').on(table.expiresAt),
  }),
);

// ============================================================
// SSO 会话表 - 记录每次免密登录会话
// ============================================================
export const ssoSessions = sqliteTable(
  'sys_sso_sessions',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id', { length: 64 }).notNull().unique(),
    appId: text('app_id', { length: 32 }).notNull(),
    userId: text('user_id', { length: 32 }).notNull(),
    username: text('username', { length: 64 }),
    // 登录方式
    loginType: text('login_type', { length: 32 }).notNull(),
    // 目标系统返回的 session/token（加密存储）
    externalSessionId: text('external_session_id', { length: 500 }),
    // 状态
    status: text('status', { length: 16 }).notNull().default('active'), // active / expired / revoked / logout
    // 时间
    loginAt: integer('login_at', { mode: 'timestamp' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    logoutAt: integer('logout_at', { mode: 'timestamp' }),
    // 请求信息
    ip: text('ip', { length: 64 }),
    userAgent: text('user_agent', { length: 500 }),
    // 登出类型: user_initiated / admin_revoked / expired / timeout
    logoutType: text('logout_type', { length: 32 }),
    logoutReason: text('logout_reason', { length: 255 }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxSession: index('idx_sso_session').on(table.sessionId),
    idxAppUser: index('idx_sso_session_app_user').on(table.appId, table.userId),
    idxStatus: index('idx_sso_session_status').on(table.status),
    idxLoginAt: index('idx_sso_login_at').on(table.loginAt),
  }),
);

// ============================================================
// SSO 登录审计日志表
// ============================================================
export const ssoAuditLogs = sqliteTable(
  'sys_sso_audit_logs',
  {
    id: text('id').primaryKey(),
    appId: text('app_id', { length: 32 }),
    appName: text('app_name', { length: 128 }),
    userId: text('user_id', { length: 32 }),
    username: text('username', { length: 64 }),
    // 事件类型: login / logout / ticket_created / ticket_used / ticket_failed / binding_created / binding_removed
    eventType: text('event_type', { length: 32 }).notNull(),
    // 登录方式
    loginType: text('login_type', { length: 32 }),
    // 结果: success / failed / denied
    result: text('result', { length: 16 }).notNull(),
    // 失败原因
    failureReason: text('failure_reason', { length: 255 }),
    // 详情
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>().default({}),
    // 请求信息
    ip: text('ip', { length: 64 }),
    userAgent: text('user_agent', { length: 500 }),
    // 关联的会话 ID
    sessionId: text('session_id', { length: 64 }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxApp: index('idx_sso_audit_app').on(table.appId),
    idxUser: index('idx_sso_audit_user').on(table.userId),
    idxEventType: index('idx_sso_audit_event').on(table.eventType),
    idxCreatedAt: index('idx_sso_audit_created').on(table.createdAt),
  }),
);
