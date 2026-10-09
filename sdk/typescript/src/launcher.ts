/**
 * A 系统 Launcher：让 A 的用户免登跳转到 B。
 *
 * 两种模式：
 * - Bearer 模式（推荐）：A 用户已在中台登录，A 后端拿中台 JWT 调
 *   GET /api/sso/redirect?to=&redirect= ，中台 302 到 B
 * - Token 模式（兼容老应用）：A 自己签 launch token，调
 *   POST /api/sso/launch，中台用 A 在中台登记的 secret_key 验签后换 B token
 *
 * A 系统 5 行接入（Bearer 模式，Next.js App Router 示例）：
 *
 *   import { Launcher } from '@integration-hub/sdk/launcher';
 *   const launcher = new Launcher({
 *     platformUrl: 'http://127.0.0.1:8000',
 *     accessToken: request.session.zhongtaiToken,
 *   });
 *   return Response.redirect(await launcher.redirectUrl({ target: 'appb', redirect: '/dashboard' }), 302);
 */

import jwt from 'jsonwebtoken';

export interface LauncherOptions {
  platformUrl?: string;
  accessToken?: string;  // Bearer 模式
  sourceApp?: string;    // Token 模式
  sourceSecret?: string; // Token 模式
  apiKey?: string;
  environment?: string;
  workspaceId?: string;
  userId?: string;
  username?: string;
}

export class LauncherError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status = 0, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export class Launcher {
  private platformUrl: string;
  private accessToken: string;
  private sourceApp: string;
  private sourceSecret: string;
  private apiKey: string;
  private environment: string;
  private workspaceId: string;
  private userId: string;
  private username: string;

  constructor(opts: LauncherOptions = {}) {
    this.platformUrl = (opts.platformUrl || 'http://127.0.0.1:8000').replace(/\/+$/, '');
    this.accessToken = opts.accessToken || '';
    this.sourceApp = opts.sourceApp || '';
    this.sourceSecret = opts.sourceSecret || '';
    this.apiKey = opts.apiKey || '';
    this.environment = opts.environment || 'dev';
    this.workspaceId = opts.workspaceId || '';
    this.userId = opts.userId || '';
    this.username = opts.username || '';
  }

  /**
   * 返回跳转到 B 的免登 URL（Bearer 模式）。
   * A 后端用 302 重定向到这个 URL 即可。
   */
  async redirectUrl(opts: { target: string; redirect?: string }): Promise<string> {
    if (!this.accessToken) throw new LauncherError('Bearer 模式需要 accessToken');
    const params = new URLSearchParams({ to: opts.target });
    if (opts.redirect) params.set('redirect', opts.redirect);
    // 不跟随重定向：用 fetch + redirect:'manual'
    const url = `${this.platformUrl}/api/sso/redirect?${params}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'X-Environment': this.environment,
    };
    if (this.workspaceId) headers['X-Workspace-Id'] = this.workspaceId;
    const resp = await fetch(url, { method: 'GET', headers, redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('Location') || '';
      if (loc) return loc;
    }
    // 中台返回 JSON（form_based/oauth2/saml）
    const text = await resp.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    const u = data.url || data.loginUrl;
    if (u) return u;
    throw new LauncherError(data.error || `中台返回 ${resp.status}`, resp.status, data);
  }

  /**
   * Token 模式（兼容老应用）：A 自己签 launch token 调中台 /api/sso/launch。
   */
  async launchViaToken(opts: { target: string; redirect?: string }): Promise<string> {
    if (!this.sourceApp || !this.sourceSecret) {
      throw new LauncherError('Token 模式需要 sourceApp + sourceSecret');
    }
    const token = jwt.sign(
      {
        sub: this.userId,
        username: this.username,
        iss: this.sourceApp,
      },
      this.sourceSecret,
      { algorithm: 'HS256', expiresIn: 60 },
    );
    const body = {
      from: this.sourceApp,
      to: opts.target,
      token,
      redirectUrl: opts.redirect || '',
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Environment': this.environment,
    };
    if (this.apiKey) headers['X-Api-Key'] = this.apiKey;
    if (this.workspaceId) headers['X-Workspace-Id'] = this.workspaceId;
    const resp = await fetch(`${this.platformUrl}/api/sso/launch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    const u = data.url || data.loginUrl;
    if (u) return u;
    throw new LauncherError(data.error || `中台返回 ${resp.status}`, resp.status, data);
  }
}
