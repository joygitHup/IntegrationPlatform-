import { db } from '@/server/db';
import { applications, userAppBindings, ssoSessions, ssoAuditLogs, ssoTickets, users } from '@/server/db/schema';
import { eq, and, desc, like, ilike, inArray, count, sql } from 'drizzle-orm';
import { generateId } from '@/server/utils/id';
import { encrypt, decrypt } from '@/server/utils/encryption';

// ============================================================
// 应用管理服务
// ============================================================

// 登录方式类型
export type LoginType = 'jwt' | 'ticket' | 'oauth2' | 'saml' | 'form_based';

// 应用分类
export const APP_CATEGORIES = [
  { code: 'business', name: '业务系统' },
  { code: 'office', name: '办公协同' },
  { code: 'data', name: '数据平台' },
  { code: 'devops', name: '研发运维' },
  { code: 'hr', name: '人力资源' },
  { code: 'finance', name: '财务系统' },
  { code: 'other', name: '其他' },
];

// 登录方式配置
export const LOGIN_TYPES = [
  { code: 'jwt', name: 'JWT 令牌跳转', description: '自研系统推荐，安全性高，实现简单' },
  { code: 'ticket', name: '一次性 Ticket', description: '简单快速，适用于遗留系统' },
  { code: 'oauth2', name: 'OAuth2 / OIDC', description: '标准协议，对接 SaaS 系统' },
  { code: 'saml', name: 'SAML 2.0', description: '企业级，对接 AD/ADFS' },
  { code: 'form_based', name: '表单代填', description: '兜底方案，兼容性最好' },
];

// ============================================================
// 应用 CRUD
// ============================================================

// 列表查询
export async function listApplications(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  status?: string;
  loginType?: string;
  visibleOnly?: boolean;
}) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const where: any[] = [];
  if (params.keyword) {
    where.push(
      sql`(${applications.name} LIKE ${'%' + params.keyword + '%'} OR ${applications.code} LIKE ${'%' + params.keyword + '%'})`
    );
  }
  if (params.category && params.category !== '__all__') {
    where.push(eq(applications.category, params.category));
  }
  if (params.status) {
    where.push(eq(applications.status, params.status));
  }
  if (params.loginType) {
    where.push(eq(applications.loginType, params.loginType));
  }
  if (params.visibleOnly) {
    where.push(eq(applications.visible, true));
  }

  const whereClause = where.length > 0 ? and(...where) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(applications)
      .where(whereClause)
      .orderBy(sql`${applications.sortOrder} ASC, ${applications.createdAt} DESC`)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(applications)
      .where(whereClause),
  ]);

  // 脱敏敏感字段
  const safeItems = items.map(app => ({
    ...app,
    secretKey: app.secretKey ? maskSecret(app.secretKey) : null,
    oauthClientSecret: app.oauthClientSecret ? maskSecret(app.oauthClientSecret) : null,
    samlCert: app.samlCert ? '********' : null,
  }));

  return {
    items: safeItems,
    total: totalResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

// 详情
export async function getApplication(id: string) {
  const rows = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
  if (rows.length === 0) return null;
  const app = rows[0];
  return {
    ...app,
    secretKey: app.secretKey ? maskSecret(app.secretKey) : null,
    oauthClientSecret: app.oauthClientSecret ? maskSecret(app.oauthClientSecret) : null,
  };
}

// 创建
export async function createApplication(data: {
  name: string;
  code: string;
  description?: string;
  icon?: string;
  category: string;
  loginType: string;
  loginUrl?: string;
  logoutUrl?: string;
  callbackUrl?: string;
  secretKey?: string;
  settings?: Record<string, unknown>;
  jwtAlgorithm?: string;
  jwtExpiresIn?: number;
  ticketExpiresIn?: number;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthAuthUrl?: string;
  oauthTokenUrl?: string;
  oauthUserInfoUrl?: string;
  oauthScope?: string;
  samlIdpMetadataUrl?: string;
  samlSpEntityId?: string;
  samlCert?: string;
  accountMapping?: string;
  mappingAttribute?: string;
  ipWhitelistEnabled?: boolean;
  ipWhitelist?: string[];
  sortOrder?: number;
  visible?: boolean;
  status?: string;
  createdBy?: string;
}, operatorId?: string) {
  const id = generateId('app');

  const insertData: any = {
    id,
    name: data.name,
    code: data.code,
    description: data.description ?? null,
    icon: data.icon ?? null,
    category: data.category,
    loginType: data.loginType,
    loginUrl: data.loginUrl ?? null,
    logoutUrl: data.logoutUrl ?? null,
    callbackUrl: data.callbackUrl ?? null,
    settings: data.settings ?? {},
    jwtAlgorithm: data.jwtAlgorithm ?? 'HS256',
    jwtExpiresIn: data.jwtExpiresIn ?? 30,
    ticketExpiresIn: data.ticketExpiresIn ?? 60,
    oauthClientId: data.oauthClientId ?? null,
    oauthAuthUrl: data.oauthAuthUrl ?? null,
    oauthTokenUrl: data.oauthTokenUrl ?? null,
    oauthUserInfoUrl: data.oauthUserInfoUrl ?? null,
    oauthScope: data.oauthScope ?? null,
    samlIdpMetadataUrl: data.samlIdpMetadataUrl ?? null,
    samlSpEntityId: data.samlSpEntityId ?? null,
    accountMapping: data.accountMapping ?? 'same_username',
    mappingAttribute: data.mappingAttribute ?? null,
    ipWhitelistEnabled: data.ipWhitelistEnabled ?? false,
    ipWhitelist: data.ipWhitelist ?? [],
    sortOrder: data.sortOrder ?? 0,
    visible: data.visible ?? true,
    status: data.status ?? 'active',
    createdBy: operatorId ?? null,
  };

  // 加密敏感字段
  if (data.secretKey) {
    insertData.secretKey = encrypt(data.secretKey);
  }
  if (data.oauthClientSecret) {
    insertData.oauthClientSecret = encrypt(data.oauthClientSecret);
  }
  if (data.samlCert) {
    insertData.samlCert = encrypt(data.samlCert);
  }

  await db.insert(applications).values(insertData);

  return getApplication(id);
}

// 更新
export async function updateApplication(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    icon: string;
    category: string;
    loginType: string;
    loginUrl: string;
    logoutUrl: string;
    callbackUrl: string;
    secretKey: string;
    settings: Record<string, unknown>;
    jwtAlgorithm: string;
    jwtExpiresIn: number;
    ticketExpiresIn: number;
    oauthClientId: string;
    oauthClientSecret: string;
    oauthAuthUrl: string;
    oauthTokenUrl: string;
    oauthUserInfoUrl: string;
    oauthScope: string;
    samlIdpMetadataUrl: string;
    samlSpEntityId: string;
    samlCert: string;
    accountMapping: string;
    mappingAttribute: string;
    ipWhitelistEnabled: boolean;
    ipWhitelist: string[];
    sortOrder: number;
    visible: boolean;
    status: string;
  }>,
  operatorId?: string,
) {
  const updateData: any = { ...data };

  // 敏感字段加密
  if (data.secretKey) {
    updateData.secretKey = encrypt(data.secretKey);
  }
  if (data.oauthClientSecret) {
    updateData.oauthClientSecret = encrypt(data.oauthClientSecret);
  }
  if (data.samlCert) {
    updateData.samlCert = encrypt(data.samlCert);
  }

  updateData.updatedAt = new Date();

  await db.update(applications).set(updateData).where(eq(applications.id, id));

  return getApplication(id);
}

// 删除
export async function deleteApplication(id: string) {
  await db.delete(applications).where(eq(applications.id, id));
  return true;
}

// 切换状态
export async function toggleApplicationStatus(id: string, status: string) {
  await db.update(applications).set({ status, updatedAt: new Date() }).where(eq(applications.id, id));
  return true;
}

// 获取应用明文密钥（内部使用）
export async function getApplicationWithSecrets(id: string) {
  const rows = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
  if (rows.length === 0) return null;
  const app = rows[0];
  return {
    ...app,
    secretKey: app.secretKey ? decrypt(app.secretKey) : null,
    oauthClientSecret: app.oauthClientSecret ? decrypt(app.oauthClientSecret) : null,
    samlCert: app.samlCert ? decrypt(app.samlCert) : null,
  };
}

// ============================================================
// 用户-应用绑定
// ============================================================

export async function getUserBindings(userId: string) {
  return db
    .select({
      id: userAppBindings.id,
      userId: userAppBindings.userId,
      appId: userAppBindings.appId,
      appName: applications.name,
      appCode: applications.code,
      appIcon: applications.icon,
      appCategory: applications.category,
      loginType: applications.loginType,
      externalUserId: userAppBindings.externalUserId,
      externalUsername: userAppBindings.externalUsername,
      status: userAppBindings.status,
      lastLoginAt: userAppBindings.lastLoginAt,
      loginCount: userAppBindings.loginCount,
    })
    .from(userAppBindings)
    .leftJoin(applications, eq(userAppBindings.appId, applications.id))
    .where(eq(userAppBindings.userId, userId))
    .orderBy(desc(userAppBindings.lastLoginAt));
}

export async function getUserBinding(userId: string, appId: string) {
  const rows = await db
    .select()
    .from(userAppBindings)
    .where(and(eq(userAppBindings.userId, userId), eq(userAppBindings.appId, appId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createUserBinding(userId: string, appId: string, data: {
  externalUserId?: string;
  externalUsername?: string;
  credentials?: Record<string, unknown>;
}) {
  const id = generateId('bind');
  const encryptedCredentials = data.credentials ? encrypt(JSON.stringify(data.credentials)) : null;

  await db.insert(userAppBindings).values({
    id,
    userId,
    appId,
    externalUserId: data.externalUserId ?? null,
    externalUsername: data.externalUsername ?? null,
    encryptedCredentials,
    status: 'active',
  });

  return id;
}

export async function updateUserBinding(userId: string, appId: string, data: {
  externalUserId?: string;
  externalUsername?: string;
  credentials?: Record<string, unknown>;
  status?: string;
}) {
  const updateData: any = {};
  if (data.externalUserId !== undefined) updateData.externalUserId = data.externalUserId;
  if (data.externalUsername !== undefined) updateData.externalUsername = data.externalUsername;
  if (data.status) updateData.status = data.status;
  if (data.credentials) {
    updateData.encryptedCredentials = encrypt(JSON.stringify(data.credentials));
  }
  updateData.updatedAt = new Date();

  await db
    .update(userAppBindings)
    .set(updateData)
    .where(and(eq(userAppBindings.userId, userId), eq(userAppBindings.appId, appId)));
}

export async function deleteUserBinding(bindingId: string) {
  await db.delete(userAppBindings).where(eq(userAppBindings.id, bindingId));
}

export async function updateUserBindingById(bindingId: string, data: {
  externalUserId?: string;
  externalUsername?: string;
  credentials?: Record<string, unknown>;
  status?: string;
}) {
  const updateData: any = {};
  if (data.externalUserId !== undefined) updateData.externalUserId = data.externalUserId;
  if (data.externalUsername !== undefined) updateData.externalUsername = data.externalUsername;
  if (data.status) updateData.status = data.status;
  if (data.credentials) {
    updateData.encryptedCredentials = encrypt(JSON.stringify(data.credentials));
  }
  updateData.updatedAt = new Date();

  await db
    .update(userAppBindings)
    .set(updateData)
    .where(eq(userAppBindings.id, bindingId));
}

export async function incrementLoginCount(userId: string, appId: string) {
  const binding = await getUserBinding(userId, appId);
  if (binding) {
    await db
      .update(userAppBindings)
      .set({ lastLoginAt: new Date(), loginCount: binding.loginCount + 1, updatedAt: new Date() })
      .where(eq(userAppBindings.id, binding.id));
  }
}

// ============================================================
// 工具函数
// ============================================================

function maskSecret(secret: string): string {
  if (secret.length <= 6) return '****';
  return secret.slice(0, 3) + '****' + secret.slice(-3);
}

// 获取用户可见的应用列表（带绑定状态）
export async function getUserApplications(userId: string, category?: string) {
  const apps = await listApplications({
    pageSize: 100,
    status: 'active',
    visibleOnly: true,
    category,
  });

  const bindings = await getUserBindings(userId);
  const bindingMap = new Map(bindings.map(b => [b.appId, b]));

  return apps.items.map(app => ({
    ...app,
    isBound: bindingMap.has(app.id!),
    binding: bindingMap.get(app.id!) || null,
  }));
}

// ============================================================
// SSO 审计日志
// ============================================================

export async function recordSsoAudit(data: {
  appId?: string;
  appName?: string;
  userId?: string;
  username?: string;
  eventType: string;
  loginType?: string;
  result: string;
  failureReason?: string;
  detail?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
}) {
  const id = generateId('sso-audit');
  await db.insert(ssoAuditLogs).values({
    id,
    ...data,
    detail: data.detail ?? {},
  });
  return id;
}

export async function listSsoAuditLogs(params: {
  page?: number;
  pageSize?: number;
  appId?: string;
  userId?: string;
  eventType?: string;
  result?: string;
  startDate?: string;
  endDate?: string;
}) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const where: any[] = [];
  if (params.appId) where.push(eq(ssoAuditLogs.appId, params.appId));
  if (params.userId) where.push(eq(ssoAuditLogs.userId, params.userId));
  if (params.eventType) where.push(eq(ssoAuditLogs.eventType, params.eventType));
  if (params.result) where.push(eq(ssoAuditLogs.result, params.result));
  if (params.startDate) {
    where.push(sql`${ssoAuditLogs.createdAt} >= ${new Date(params.startDate).getTime()}`);
  }
  if (params.endDate) {
    where.push(sql`${ssoAuditLogs.createdAt} <= ${new Date(params.endDate).getTime()}`);
  }

  const whereClause = where.length > 0 ? and(...where) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(ssoAuditLogs)
      .where(whereClause)
      .orderBy(desc(ssoAuditLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(ssoAuditLogs)
      .where(whereClause),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

// ============================================================
// SSO 会话管理
// ============================================================

export async function createSsoSession(data: {
  sessionId: string;
  appId: string;
  userId: string;
  username: string;
  loginType: string;
  externalSessionId?: string;
  expiresAt?: Date;
  ip?: string;
  userAgent?: string;
}) {
  const id = generateId('sso-sess');
  await db.insert(ssoSessions).values({
    id,
    sessionId: data.sessionId,
    appId: data.appId,
    userId: data.userId,
    username: data.username,
    loginType: data.loginType,
    externalSessionId: data.externalSessionId ? encrypt(data.externalSessionId) : null,
    status: 'active',
    loginAt: new Date(),
    expiresAt: data.expiresAt ?? null,
    ip: data.ip ?? null,
    userAgent: data.userAgent ?? null,
  });
  return id;
}

export async function listSsoSessions(params: {
  page?: number;
  pageSize?: number;
  appId?: string;
  userId?: string;
  status?: string;
}) {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const where: any[] = [];
  if (params.appId) where.push(eq(ssoSessions.appId, params.appId));
  if (params.userId) where.push(eq(ssoSessions.userId, params.userId));
  if (params.status) where.push(eq(ssoSessions.status, params.status));

  const whereClause = where.length > 0 ? and(...where) : undefined;

  const [items, totalResult] = await Promise.all([
    db
      .select()
      .from(ssoSessions)
      .where(whereClause)
      .orderBy(desc(ssoSessions.loginAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(ssoSessions)
      .where(whereClause),
  ]);

  return {
    items,
    total: totalResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function revokeSsoSession(sessionId: string, reason: string = 'admin_revoked') {
  await db
    .update(ssoSessions)
    .set({
      status: 'revoked',
      logoutAt: new Date(),
      logoutType: 'admin_revoked',
      logoutReason: reason,
    })
    .where(eq(ssoSessions.sessionId, sessionId));
  return true;
}

// 撤销用户所有会话（单点登出 SLO）
export async function revokeAllUserSessions(userId: string, reason: string = 'slo') {
  await db
    .update(ssoSessions)
    .set({
      status: 'revoked',
      logoutAt: new Date(),
      logoutType: reason,
      logoutReason: '单点登出',
    })
    .where(and(eq(ssoSessions.userId, userId), eq(ssoSessions.status, 'active')));
  return true;
}

// ============================================================
// Ticket 管理
// ============================================================

export async function createTicket(appId: string, userId: string, userInfo: Record<string, unknown>, ip?: string, userAgent?: string) {
  const app = await getApplicationWithSecrets(appId);
  if (!app) throw new Error('应用不存在');

  const ticket = generateId('ticket') + generateId('t');
  const expiresIn = app.ticketExpiresIn || 60;
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const id = generateId('tkt');
  await db.insert(ssoTickets).values({
    id,
    ticket,
    appId,
    userId,
    userInfo,
    status: 'pending',
    expiresAt,
    ip: ip ?? null,
    userAgent: userAgent ?? null,
  });

  return { ticket, expiresAt, expiresIn };
}

export async function validateTicket(ticket: string, ip?: string) {
  const rows = await db.select().from(ssoTickets).where(eq(ssoTickets.ticket, ticket)).limit(1);
  if (rows.length === 0) {
    return { valid: false, error: 'ticket_not_found' };
  }

  const tkt = rows[0];

  // 检查状态
  if (tkt.status === 'used') {
    return { valid: false, error: 'ticket_already_used', ticket: tkt };
  }
  if (tkt.status === 'revoked') {
    return { valid: false, error: 'ticket_revoked', ticket: tkt };
  }
  if (tkt.status !== 'pending') {
    return { valid: false, error: 'ticket_invalid_status', ticket: tkt };
  }

  // 检查过期
  if (new Date() > new Date(tkt.expiresAt)) {
    await db.update(ssoTickets).set({ status: 'expired' }).where(eq(ssoTickets.id, tkt.id));
    return { valid: false, error: 'ticket_expired', ticket: tkt };
  }

  // 标记为已使用
  await db
    .update(ssoTickets)
    .set({ status: 'used', usedAt: new Date(), consumedIp: ip ?? null })
    .where(eq(ssoTickets.id, tkt.id));

  return { valid: true, ticket: tkt };
}
