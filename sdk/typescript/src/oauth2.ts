/**
 * OAuth2 类型 SSO 接入：A 系统作为 OAuth2 客户端接入中台。
 *
 * 标准 OAuth2 授权码 + PKCE 流程。
 *
 *   import { OAuth2Client } from '@integration-hub/sdk/sso';
 *   const oauth = new OAuth2Client({
 *     clientId: 'appa', clientSecret: '...', redirectUri: 'http://A/oauth/callback',
 *   });
 *   // 登录入口
 *   const { url, verifier, state } = oauth.createAuthorizationUrl(crypto.randomUUID());
 *   return Response.redirect(url, 302);
 *   // callback 路由
 *   const tokens = await oauth.exchange(code, verifier);
 */

import { createHash, randomBytes } from 'crypto';

export interface SsoConfig {
  platformUrl: string;
  audience?: string;
  appId?: string;
  appSecret?: string;
  autoCreateUser?: boolean;
  defaultRedirect?: string;
  redirectUri?: string;
  onSuccess?: (user: SsoUserInfo, request: Request) => Promise<void>;
}

export interface SsoUserInfo {
  sub?: string;
  username?: string;
  email?: string;
  displayName?: string;
  roleId?: string;
  [key: string]: unknown;
}

let _config: SsoConfig = {
  platformUrl: 'http://127.0.0.1:8000',
  audience: '',
  appId: '',
  appSecret: '',
  autoCreateUser: false,
  defaultRedirect: '/dashboard',
  redirectUri: '',
};

export function configure(opts: Partial<SsoConfig>): void {
  _config = { ..._config, ...opts };
}

export function getConfig(): SsoConfig {
  return _config;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url');
  const digest = createHash('sha256').update(verifier).digest();
  const challenge = digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

export interface AuthorizationResult {
  url: string;
  verifier: string;
  state: string;
}

export function authorizationUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
  codeChallenge?: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    scope: opts.scope || 'openid profile email',
  });
  if (opts.codeChallenge) {
    params.set('code_challenge', opts.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${_config.platformUrl}/api/oauth/authorize?${params}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user_info?: SsoUserInfo;
}

export async function exchangeCode(
  code: string,
  opts: {
    clientId?: string;
    clientSecret?: string;
    redirectUri?: string;
    codeVerifier?: string;
  } = {}
): Promise<TokenResponse | null> {
  const clientId = opts.clientId || _config.appId || '';
  const redirectUri = opts.redirectUri || _config.redirectUri || '';
  const basicAuth =
    opts.clientId && opts.clientSecret
      ? Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64')
      : undefined;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  if (clientId) body.set('client_id', clientId);
  if (opts.clientSecret) body.set('client_secret', opts.clientSecret);
  if (opts.codeVerifier) body.set('code_verifier', opts.codeVerifier);
  const resp = await fetch(`${_config.platformUrl}/api/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(basicAuth ? { Authorization: `Basic ${basicAuth}` } : {}),
    },
    body,
  });
  if (!resp.ok) return null;
  const tokens = await resp.json();
  if (!tokens.access_token) return null;
  // 拿 userinfo
  const uiResp = await fetch(`${_config.platformUrl}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userInfo = uiResp.ok ? await uiResp.json() : {};
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    user_info: userInfo as SsoUserInfo,
  };
}

export class OAuth2Client {
  constructor(
    private clientId: string,
    private clientSecret: string = '',
    private redirectUri: string = '',
    private scope: string = 'openid profile email',
  ) {}

  createAuthorizationUrl(state: string): AuthorizationResult {
    const { verifier, challenge } = createPkcePair();
    const url = authorizationUrl({
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      state,
      scope: this.scope,
      codeChallenge: challenge,
    });
    return { url, verifier, state };
  }

  exchange(code: string, verifier: string = ''): Promise<TokenResponse | null> {
    return exchangeCode(code, {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: this.redirectUri,
      codeVerifier: verifier,
    });
  }
}
