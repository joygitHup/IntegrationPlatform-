/**
 * Form-Based 类型 SSO 接入：A 系统绑定 B 系统账号密码，中台代填。
 *
 *   import { FormBasedLauncher } from '@integration-hub/sdk/form';
 *   const fb = new FormBasedLauncher({ apiKey: 'ipk_...', appId: 'appb' });
 *   await fb.bind(user.id, user.username, user.password);
 *   const result = fb.launch(user.id, '/dashboard');
 *   if (result.needBinding) { ... }
 */

export interface FormBasedOptions {
  apiKey: string;
  appId: string;
  platformUrl?: string;
  environment?: string;
}

export interface BindResult {
  id?: string;
  error?: string;
}

export interface LaunchResult {
  type?: string;
  url?: string;
  html?: string;
  needBinding?: boolean;
  loginUrl?: string;
  error?: string;
  [key: string]: unknown;
}

export class FormBasedLauncher {
  private opts: Required<FormBasedOptions>;

  constructor(opts: FormBasedOptions) {
    this.opts = {
      apiKey: opts.apiKey,
      appId: opts.appId,
      platformUrl: (opts.platformUrl || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
      environment: opts.environment || 'dev',
    };
  }

  async bind(userId: string, username: string, password: string, externalUsername: string = ''): Promise<BindResult> {
    const resp = await fetch(`${this.opts.platformUrl}/api/apps/bindings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.opts.apiKey,
        'X-Environment': this.opts.environment,
      },
      body: JSON.stringify({
        appId: this.opts.appId,
        userId,
        credentials: { username, password },
        externalUsername: externalUsername || username,
      }),
    });
    return resp.json();
  }

  async launch(userId: string = '', redirect: string = ''): Promise<LaunchResult> {
    const body: Record<string, string> = { appId: this.opts.appId };
    if (userId) body.userId = userId;
    if (redirect) body.redirectUrl = redirect;
    const resp = await fetch(`${this.opts.platformUrl}/api/sso/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.opts.apiKey,
        'X-Environment': this.opts.environment,
      },
      body: JSON.stringify(body),
    });
    return resp.json();
  }
}
