import { sign as jwtSign, verify as jwtVerify, Algorithm } from 'jsonwebtoken';
import { eq, and, desc, gt, lt, sql } from 'drizzle-orm';
import { generateId } from '@/server/utils/id';
import { db } from '@/server/db';
import {
  applications,
  userAppBindings,
  ssoTickets,
  ssoSessions,
  ssoAuditLogs,
} from '@/server/db/schema/sso';
import { decrypt } from '@/server/utils/encryption';
import { recordSsoAudit, listSsoAuditLogs } from './app-service';

// 获取应用（含解密后的配置）
async function getApplicationWithSecrets(appId: string) {
  const app = await db.select().from(applications).where(eq(applications.id, appId)).get();
  if (!app) return null;
  const settings = app.settings as Record<string, unknown> | null;
  // 解密敏感字段
  if (settings && typeof settings === 'object') {
    if (settings.clientSecret && typeof settings.clientSecret === 'string') {
      try { settings.clientSecret = decrypt(settings.clientSecret); } catch { /* 忽略 */ }
    }
    if (settings.appSecret && typeof settings.appSecret === 'string') {
      try { settings.appSecret = decrypt(settings.appSecret); } catch { /* 忽略 */ }
    }
    if (settings.sharedKey && typeof settings.sharedKey === 'string') {
      try { settings.sharedKey = decrypt(settings.sharedKey); } catch { /* 忽略 */ }
    }
    if (settings.privateKey && typeof settings.privateKey === 'string') {
      try { settings.privateKey = decrypt(settings.privateKey); } catch { /* 忽略 */ }
    }
  }
  return { ...app, settings };
}

// 创建一次性 Ticket
async function createTicket(
  appId: string,
  userId: string,
  ticketValue: string,
  expiresAt: Date,
  ip?: string,
  userAgent?: string,
) {
  await db.insert(ssoTickets).values({
    id: generateId('ticket'),
    appId,
    userId,
    ticket: ticketValue,
    status: 'pending',
    expiresAt,
    ip,
    userAgent,
  });
  return ticketValue;
}

// ============================================================
// SSO 登录引擎
// 支持 4 种登录方式：JWT 跳转、一次性 Ticket、OAuth2、SAML
// ============================================================

// ============================================================
// 1. JWT 令牌跳转
// ============================================================

/**
 * 生成 JWT 免密登录 URL
 * @param appId 应用ID
 * @param user 用户信息
 * @param redirectPath 跳转路径
 * @param ip 用户IP
 * @param userAgent 用户代理
 */
export async function generateJwtLoginUrl(
  appId: string,
  user: { id: string; username: string; email?: string | null; displayName?: string | null; roleId?: string | null },
  redirectPath?: string,
  ip?: string,
  userAgent?: string,
) {
  const app = await getApplicationWithSecrets(appId);
  if (!app) {
    throw new Error('应用不存在');
  }
  if (app.status !== 'active') {
    throw new Error('应用未启用');
  }
  if (!app.secretKey) {
    throw new Error('应用未配置密钥');
  }
  if (!app.loginUrl) {
    throw new Error('应用未配置登录地址');
  }

  // IP 白名单检查
  if (app.ipWhitelistEnabled && app.ipWhitelist && app.ipWhitelist.length > 0 && ip) {
    if (!app.ipWhitelist.includes(ip)) {
      await recordSsoAudit({
        appId,
        appName: app.name,
        userId: user.id,
        username: user.username,
        eventType: 'LOGIN',
        loginType: 'jwt',
        result: 'failed',
        failureReason: 'IP 不在白名单',
        ip,
        userAgent,
      });
      throw new Error('IP 不在白名单内');
    }
  }

  const expiresIn = (app.jwtExpiresIn || 30) as number;
  const algorithm = (app.jwtAlgorithm || 'HS256') as Algorithm;

  // 构建 payload
  const payload: Record<string, unknown> = {
    sub: user.id,
    username: user.username,
    email: user.email || '',
    displayName: user.displayName || user.username,
    roleId: user.roleId || '',
    iss: 'integration-platform',
    aud: app.code,
    jti: generateId('jti'),
  };

  // 合并自定义字段
  if (app.settings && typeof app.settings === 'object' && 'customClaims' in app.settings) {
    Object.assign(payload, (app.settings as any).customClaims);
  }

  // 签名
  const token = jwtSign(payload, app.secretKey, {
    algorithm,
    expiresIn: `${expiresIn}s`,
  });

  // 构建 URL
  const baseUrl = app.loginUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  const tokenParam = (app.settings as any)?.tokenParamName || 'token';
  let url = `${baseUrl}${separator}${tokenParam}=${encodeURIComponent(token)}`;

  if (redirectPath) {
    url += `&redirect=${encodeURIComponent(redirectPath)}`;
  }

  // 记录审计
  const sessionId = generateId('sso-sess');
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  await recordSsoAudit({
    appId,
    appName: app.name,
    userId: user.id,
    username: user.username,
    eventType: 'LOGIN',
    loginType: 'jwt',
    result: 'success',
    ip,
    userAgent,
    sessionId,
  });

  await createSsoSession({
    sessionId,
    appId,
    userId: user.id,
    username: user.username,
    loginType: 'jwt',
    expiresAt,
    ip,
    userAgent,
  });

  await incrementLoginCount(user.id, appId);

  return {
    url,
    token,
    expiresIn,
    sessionId,
  };
}

/**
 * 验证 JWT Token（供目标系统回调验证使用）
 */
export async function verifyJwtToken(appId: string, token: string) {
  const app = await getApplicationWithSecrets(appId);
  if (!app || !app.secretKey) {
    return { valid: false, error: 'app_not_found' };
  }

  try {
    const algorithm = (app.jwtAlgorithm || 'HS256') as Algorithm;
    const decoded = jwtVerify(token, app.secretKey, { algorithms: [algorithm] });
    return { valid: true, payload: decoded };
  } catch (err: any) {
    return {
      valid: false,
      error: err.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid',
      message: err.message,
    };
  }
}

// 获取用户-应用绑定
export async function getUserBinding(userId: string, appId: string) {
  return db.select().from(userAppBindings)
    .where(and(eq(userAppBindings.userId, userId), eq(userAppBindings.appId, appId)))
    .get();
}

// 创建 SSO 会话（对象参数版本）
export async function createSsoSession(data: {
  appId: string;
  userId: string;
  username?: string;
  sessionId: string;
  loginType: string;
  ip?: string;
  userAgent?: string;
  expiresAt?: Date;
  loginAt?: Date;
  externalSessionId?: string;
  status?: string;
}) {
  await db.insert(ssoSessions).values({
    id: generateId('sso_sess'),
    appId: data.appId,
    userId: data.userId,
    username: data.username,
    sessionId: data.sessionId,
    loginType: data.loginType,
    status: data.status || 'active',
    loginAt: data.loginAt || new Date(),
    expiresAt: data.expiresAt || null,
    ip: data.ip,
    userAgent: data.userAgent,
    externalSessionId: data.externalSessionId,
  });
}

// 增加登录计数
export async function incrementLoginCount(userId: string, appId: string) {
  // 更新 userAppBindings 的 lastLoginAt 和 loginCount
  const binding = await db.select().from(userAppBindings)
    .where(and(eq(userAppBindings.userId, userId), eq(userAppBindings.appId, appId)))
    .get();

  if (binding) {
    await db.update(userAppBindings).set({
      lastLoginAt: new Date(),
      loginCount: (binding.loginCount || 0) + 1,
    }).where(eq(userAppBindings.id, binding.id));
  }
}

// 列出 SSO 会话
export async function listSsoSessions(params: {
  userId?: string;
  appId?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const whereConditions: any[] = [];
  if (params.userId) whereConditions.push(eq(ssoSessions.userId, params.userId));
  if (params.appId) whereConditions.push(eq(ssoSessions.appId, params.appId));

  const query = db.select().from(ssoSessions);
  if (whereConditions.length > 0) {
    query.where(and(...whereConditions));
  }

  const [items, totalResult] = await Promise.all([
    query.orderBy(desc(ssoSessions.createdAt)).limit(pageSize).offset(offset).all(),
    db.select({ count: sql`count(*)`.as('count') }).from(ssoSessions)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined).get(),
  ]);

  return {
    items,
    total: Number((totalResult as any)?.count || 0),
    page,
    pageSize,
  };
}

// 吊销单个会话
export async function revokeSsoSession(sessionId: string, reason?: string) {
  await db.update(ssoSessions).set({
    status: 'revoked',
    logoutAt: new Date(),
    logoutType: 'admin_revoked',
    logoutReason: reason,
  }).where(eq(ssoSessions.sessionId, sessionId));
}

// 吊销用户所有会话
export async function revokeAllUserSessions(userId: string, reason?: string) {
  await db.update(ssoSessions).set({
    status: 'revoked',
    logoutAt: new Date(),
    logoutType: 'slo',
    logoutReason: reason,
  }).where(and(eq(ssoSessions.userId, userId), eq(ssoSessions.status, 'active')));
}

// ============================================================
// 2. 一次性 Ticket
// ============================================================

/**
 * 生成一次性 Ticket 登录 URL
 */
export async function generateTicketLoginUrl(
  appId: string,
  user: { id: string; username: string; email?: string | null; displayName?: string | null },
  redirectPath?: string,
  ip?: string,
  userAgent?: string,
) {
  const app = await getApplicationWithSecrets(appId);
  if (!app) throw new Error('应用不存在');
  if (app.status !== 'active') throw new Error('应用未启用');
  if (!app.loginUrl) throw new Error('应用未配置登录地址');

  // IP 白名单
  if (app.ipWhitelistEnabled && app.ipWhitelist && app.ipWhitelist.length > 0 && ip) {
    if (!app.ipWhitelist.includes(ip)) {
      await recordSsoAudit({
        appId,
        appName: app.name,
        userId: user.id,
        username: user.username,
        eventType: 'LOGIN',
        loginType: 'ticket',
        result: 'failed',
        failureReason: 'IP 不在白名单',
        ip,
        userAgent,
      });
      throw new Error('IP 不在白名单内');
    }
  }

  const userInfo: Record<string, unknown> = {
    id: user.id,
    username: user.username,
    email: user.email || '',
    displayName: user.displayName || user.username,
  };

  const { ticket, expiresAt } = await createSsoTicket(appId, user.id, userInfo, ip, userAgent);

  // 构建 URL
  const baseUrl = app.loginUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  const ticketParam = (app.settings as any)?.ticketParamName || 'ticket';
  let url = `${baseUrl}${separator}${ticketParam}=${ticket}`;

  if (redirectPath) {
    url += `&redirect=${encodeURIComponent(redirectPath)}`;
  }

  const sessionId = generateId('sso-sess');

  await recordSsoAudit({
    appId,
    appName: app.name,
    userId: user.id,
    username: user.username,
    eventType: 'LOGIN',
    loginType: 'ticket',
    result: 'success',
    detail: { ticket },
    ip,
    userAgent,
    sessionId,
  });

  await createSsoSession({
    sessionId,
    appId,
    userId: user.id,
    username: user.username,
    loginType: 'ticket',
    ip,
    userAgent,
  });

  await incrementLoginCount(user.id, appId);

  return {
    url,
    ticket,
    expiresAt,
    sessionId,
  };
}

/**
 * 验证 Ticket（供目标系统回调）
 */
export async function verifySsoTicket(ticket: string, appCode?: string, ip?: string, userAgent?: string) {
  const tkt = await db.select().from(ssoTickets)
    .where(eq(ssoTickets.ticket, ticket))
    .get();

  if (!tkt) {
    await recordSsoAudit({
      eventType: 'TICKET_VALIDATE',
      loginType: 'ticket',
      result: 'failed',
      failureReason: 'ticket_not_found',
      ip,
      userAgent,
      detail: { ticket: ticket.slice(0, 8) + '****' },
    });
    return { valid: false, error: 'ticket_not_found' };
  }

  if (tkt.status !== 'pending') {
    return { valid: false, error: 'ticket_already_used' };
  }

  if (tkt.expiresAt && new Date() > new Date(tkt.expiresAt)) {
    await db.update(ssoTickets).set({ status: 'expired' }).where(eq(ssoTickets.id, tkt.id));
    return { valid: false, error: 'ticket_expired' };
  }

  // 校验 appCode（可选）
  if (appCode) {
    const app = await getApplicationWithSecrets(tkt.appId);
    if (app && app.code !== appCode) {
      return { valid: false, error: 'app_code_mismatch' };
    }
  }

  // 标记为已使用
  await db.update(ssoTickets).set({
    status: 'used',
    usedAt: new Date(),
    consumedIp: ip,
  }).where(eq(ssoTickets.id, tkt.id));

  // 记录审计
  await recordSsoAudit({
    appId: tkt.appId,
    userId: tkt.userId,
    eventType: 'TICKET_VALIDATE',
    loginType: 'ticket',
    result: 'success',
    ip,
    userAgent,
    detail: { ticket: ticket.slice(0, 8) + '****' },
  });

  return {
    valid: true,
    userId: tkt.userId,
    userInfo: tkt.userInfo,
    appId: tkt.appId,
  };
}

// ============================================================
// 3. OAuth2 / OIDC
// ============================================================

/**
 * 生成 OAuth2 授权 URL
 */
export async function generateOAuth2Url(appId: string, state: string, redirectUri: string) {
  const app = await getApplicationWithSecrets(appId);
  if (!app) throw new Error('应用不存在');
  if (app.loginType !== 'oauth2') throw new Error('应用登录方式不是 OAuth2');
  if (!app.oauthAuthUrl || !app.oauthClientId) {
    throw new Error('OAuth2 配置不完整');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: app.oauthClientId,
    redirect_uri: redirectUri,
    state,
  });

  if (app.oauthScope) {
    params.set('scope', app.oauthScope);
  }

  // OIDC 必须的非对称随机值
  const nonce = generateId('nonce');
  params.set('nonce', nonce);

  return {
    url: `${app.oauthAuthUrl}?${params.toString()}`,
    state,
    nonce,
  };
}

/**
 * 用 code 换取 token（简化实现，真实场景需要根据具体 IdP 调整）
 */
export async function exchangeOAuth2Code(
  appId: string,
  code: string,
  redirectUri: string,
) {
  const app = await getApplicationWithSecrets(appId);
  if (!app || !app.oauthTokenUrl || !app.oauthClientId || !app.oauthClientSecret) {
    throw new Error('OAuth2 配置不完整');
  }

  try {
    const response = await fetch(app.oauthTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: app.oauthClientId,
        client_secret: app.oauthClientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const tokens = await response.json();
    return tokens; // access_token, refresh_token, id_token 等
  } catch (err: any) {
    throw new Error(`OAuth2 token 交换失败: ${err.message}`);
  }
}

/**
 * 获取用户信息
 */
export async function getOAuth2UserInfo(appId: string, accessToken: string) {
  const app = await getApplicationWithSecrets(appId);
  if (!app || !app.oauthUserInfoUrl) {
    throw new Error('用户信息接口未配置');
  }

  const response = await fetch(app.oauthUserInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`获取用户信息失败: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// 4. SAML 2.0（基础框架）
// ============================================================

/**
 * 生成 SAML AuthnRequest（简化框架）
 * 生产环境建议使用 @node-saml/node-saml 库
 */
export async function generateSamlAuthnRequest(appId: string, relayState?: string) {
  const app = await getApplicationWithSecrets(appId);
  if (!app || !app.samlIdpMetadataUrl || !app.samlSpEntityId) {
    throw new Error('SAML 配置不完整');
  }

  const id = generateId('saml-req');
  const issueInstant = new Date().toISOString();

  // 简化版 XML，生产环境需要完整的签名和 deflate + base64
  const authnRequest = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    ID="${id}"
    Version="2.0"
    IssueInstant="${issueInstant}"
    Destination="${app.samlIdpMetadataUrl}"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
    AssertionConsumerServiceURL="${app.callbackUrl || ''}">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${app.samlSpEntityId}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`;

  // Base64 编码
  const encoded = Buffer.from(authnRequest).toString('base64');

  let url = `${app.samlIdpMetadataUrl}?SAMLRequest=${encodeURIComponent(encoded)}`;
  if (relayState) {
    url += `&RelayState=${encodeURIComponent(relayState)}`;
  }

  return { url, requestId: id, relayState };
}

// ============================================================
// 统一入口：发起 SSO 登录
// ============================================================

export async function initiateSsoLogin(
  appId: string,
  user: { id: string; username: string; email?: string | null; displayName?: string | null; roleId?: string | null },
  options: {
    redirectPath?: string;
    oauthRedirectUri?: string;
    relayState?: string;
    ip?: string;
    userAgent?: string;
  } = {},
) {
  const app = await getApplicationWithSecrets(appId);
  if (!app) throw new Error('应用不存在');
  if (app.status !== 'active') throw new Error('应用未启用');

  switch (app.loginType) {
    case 'jwt':
      return generateJwtLoginUrl(appId, user, options.redirectPath, options.ip, options.userAgent);
    case 'ticket':
      return generateTicketLoginUrl(appId, user, options.redirectPath, options.ip, options.userAgent);
    case 'oauth2':
      if (!options.oauthRedirectUri) throw new Error('缺少 OAuth2 回调地址');
      const state = generateId('state');
      return generateOAuth2Url(appId, state, options.oauthRedirectUri);
    case 'saml':
      return generateSamlAuthnRequest(appId, options.relayState);
    case 'form_based':
      // 表单代填 - 返回配置信息，前端 JS 自动填充提交
      return {
        type: 'form_based',
        loginUrl: app.loginUrl,
        usernameField: (app.settings as any)?.usernameField || 'username',
        passwordField: (app.settings as any)?.passwordField || 'password',
      };
    default:
      throw new Error(`不支持的登录方式: ${app.loginType}`);
  }
}

// ============================================================
// 适配层 - 供外部 API 路由调用
// ============================================================

// SSO 审计日志
export async function recordLoginLog(data: Parameters<typeof recordSsoAudit>[0]) {
  return recordSsoAudit(data);
}

export async function getLoginLogs(params: {
  userId?: string;
  appId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  return listSsoAuditLogs(params);
}

// Ticket 验证（外部调用签名适配）
export async function validateTicket(
  ticket: string,
  options?: { ip?: string; userAgent?: string; appId?: string },
) {
  return verifySsoTicket(ticket, options?.appId, options?.ip, options?.userAgent);
}

// JWT 验证别名
export async function validateSsoToken(token: string) {
  return verifyJwtToken('', token);
}

// 会话管理适配
export async function listSessions(userId: string, options?: { page?: number; pageSize?: number }) {
  return listSsoSessions({
    userId,
    page: options?.page || 1,
    pageSize: options?.pageSize || 20,
  });
}

export async function revokeSession(sessionId: string, _userId: string) {
  await revokeSsoSession(sessionId);
  return true;
}

export async function revokeAllSessions(userId: string) {
  await revokeAllUserSessions(userId);
  return 1;
}

// OAuth2 回调处理
export async function handleOAuth2Callback(params: {
  app: any;
  code: string;
  state: string;
  ip: string;
  userAgent: string;
}) {
  const { app, code, state, ip, userAgent } = params;
  const tokenResult = await exchangeOAuth2Code(app.id, code, '');
  const userInfo = await getOAuth2UserInfo(app.id, tokenResult.accessToken);

  return {
    ...userInfo,
    accessToken: tokenResult.accessToken,
    targetUrl: app.homeUrl || app.loginUrl,
  };
}

// 创建 Ticket（适配外部调用签名：appId + user 对象）
export async function createSsoTicket(
  appId: string,
  userId: string,
  userData: Record<string, unknown>,
  ip?: string,
  userAgent?: string,
) {
  const ticketValue = generateId('sst');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5分钟
  await createTicket(appId, userId, ticketValue, expiresAt, ip, userAgent);
  return { ticket: ticketValue, expiresAt };
}
