/**
 * B 系统 SSO 接入 SDK（TypeScript）。
 *
 * 5 种 SSO 类型统一入口：
 * - jwt / ticket / oauth2 / saml / form_based（form_based 由中台代填，B 无需 SDK）
 *
 * 最小接入（Next.js App Router 示例）：
 *
 *   import { configure, verifyToken } from '@integration-hub/sdk/sso';
 *   configure({ platformUrl: 'http://127.0.0.1:8000', audience: 'app_bbb' });
 *
 *   // app/sso/callback/route.ts
 *   import { ssoCallbackHandler } from '@integration-hub/sdk/sso';
 *   export const GET = ssoCallbackHandler;
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface SsoConfig {
  platformUrl: string;
  audience?: string;
  appId?: string;
  appSecret?: string; // HS256 本地验签（兼容老应用）
  autoCreateUser?: boolean;
  defaultRedirect?: string;
  /** 验签成功后建本地会话的回调（Next.js/App Router 用）。 */
  onSuccess?: (user: SsoUserInfo, request: Request) => Promise<void>;
}

const config: SsoConfig = {
  platformUrl: 'http://127.0.0.1:8000',
  audience: '',
  appId: '',
  appSecret: '',
  autoCreateUser: false,
  defaultRedirect: '/dashboard',
};

export function configure(opts: Partial<SsoConfig>): void {
  Object.assign(config, opts);
}

export function getConfig(): SsoConfig {
  return config;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(
      new URL(`${config.platformUrl}/api/sso/.well-known/jwks.json`)
    );
  }
  return _jwks;
}

export interface SsoUserInfo {
  sub?: string;
  username?: string;
  email?: string;
  displayName?: string;
  roleId?: string;
  aud?: string;
  iss?: string;
  jti?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/**
 * 验签中台签发的 SSO JWT，返回用户信息或 null。
 *
 * 优先尝试本地 JWKS 验签（RS256），失败回退到 HS256 本地验签
 * （appSecret 已配置时），再失败回退到回调中台 /api/sso/validate。
 */
export async function verifyToken(token: string): Promise<SsoUserInfo | null> {
  // 1) 本地 RS256 验签
  const localPayload = await verifyTokenLocal(token);
  if (localPayload) return localPayload;

  // 2) 回调中台 validate（兼容老应用 + 实时吊销）
  return validateViaPlatform(token);
}

export async function verifyTokenLocal(token: string): Promise<SsoUserInfo | null> {
  // RS256：JWKS 公钥
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      algorithms: ['RS256'],
      issuer: 'integration-platform',
      audience: config.audience || undefined,
    });
    return payload as unknown as SsoUserInfo;
  } catch {
    // 回退到 HS256
  }
  // HS256：本地密钥
  if (config.appSecret) {
    try {
      const { jwtVerify: hsVerify } = await import('jose');
      const secret = new TextEncoder().encode(config.appSecret);
      const { payload } = await hsVerify(token, secret, {
        algorithms: ['HS256'],
        audience: config.audience || undefined,
      });
      return payload as unknown as SsoUserInfo;
    } catch {
      // fallthrough
    }
  }
  return null;
}

export async function validateViaPlatform(token: string): Promise<SsoUserInfo | null> {
  try {
    const resp = await fetch(
      `${config.platformUrl}/api/sso/validate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, appId: config.appId }),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.valid ? data.user : null;
  } catch {
    return null;
  }
}

/**
 * 一次性票据消费。
 */
export async function consumeTicket(ticket: string): Promise<SsoUserInfo | null> {
  try {
    const resp = await fetch(
      `${config.platformUrl}/api/sso/validate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, appId: config.appId }),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.valid ? data.user : null;
  } catch {
    return null;
  }
}

export interface CallbackParams {
  token?: string | null;
  ticket?: string | null;
  code?: string | null;
  state?: string | null;
  SAMLResponse?: string | null;
  redirect?: string | null;
}

export interface CallbackResult {
  userInfo: SsoUserInfo | null;
  redirectUrl: string;
}

/**
 * 通用回调处理器：根据 URL 参数自动识别 SSO 类型并验签。
 */
export async function handleCallback(params: CallbackParams): Promise<CallbackResult> {
  let userInfo: SsoUserInfo | null = null;
  if (params.token) {
    userInfo = await verifyToken(params.token);
  } else if (params.ticket) {
    userInfo = await consumeTicket(params.ticket);
  } else if (params.code) {
    // OAuth2 模式：P2 接入
    // const { exchangeCode } = await import('./oauth2');
    // userInfo = await exchangeCode(params.code, params.state || '');
    userInfo = null;
  } else if (params.SAMLResponse) {
    // SAML 模式：P3 接入
    // const { parseAssertion } = await import('./saml');
    // userInfo = await parseAssertion(params.SAMLResponse);
    userInfo = null;
  }
  return {
    userInfo,
    redirectUrl: params.redirect || config.defaultRedirect,
  };
}

/**
 * Next.js App Router 落地路由处理器。
 *
 *   // app/sso/callback/route.ts
 *   import { ssoCallbackHandler } from '@integration-hub/sdk/sso';
 *   export const GET = ssoCallbackHandler;
 *
 * 注意：实际本地会话建立由调用方在 onSuccess 回调里实现，
 * 这里只做验签 + 重定向。可在 configure() 里设置 onSuccess。
 */
export async function ssoCallbackHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const params: CallbackParams = {
    token: url.searchParams.get('token'),
    ticket: url.searchParams.get('ticket'),
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    SAMLResponse: url.searchParams.get('SAMLResponse'),
    redirect: url.searchParams.get('redirect'),
  };
  const { userInfo, redirectUrl } = await handleCallback(params);
  if (userInfo && config.onSuccess) {
    await config.onSuccess(userInfo, request);
  }
  if (userInfo) {
    return Response.redirect(new URL(redirectUrl, url), 302);
  }
  return Response.redirect(new URL('/login', url), 302);
}

export {};
