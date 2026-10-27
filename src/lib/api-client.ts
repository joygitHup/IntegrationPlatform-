'use client';

import type { ConfigSchema } from '@/components/dynamic-config-form';

// 推荐 NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api/v1；后端 /api/v1/ 与 /api/ 等价（历史兼容）
// 未设时同源 /api 反代到 Django（仍可用，但建议显式带上版本号 /api/v1）
const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE || '/api').replace(/\/+$/, '');

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  _retry?: boolean;
}

class ApiClient {
  private token: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('access_token', token);
    } else {
      localStorage.removeItem('access_token');
    }
  }

  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    if (this.token) return this.token;
    return localStorage.getItem('access_token');
  }

  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('refresh_token');
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  }

  private async tryRefresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const data = await this.request<{ accessToken: string; refreshToken: string }>(
          '/auth/refresh',
          {
            method: 'POST',
            skipAuth: true,
            body: JSON.stringify({ refreshToken }),
          },
        );
        if (!data?.accessToken) return false;
        this.setToken(data.accessToken);
        if (data.refreshToken) {
          localStorage.setItem('refresh_token', data.refreshToken);
        }
        return true;
      } catch {
        return false;
      }
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const normalizedPath = path.startsWith('http')
      ? path
      : `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (!options.skipAuth) {
      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    const storedEnv =
      typeof window !== 'undefined' ? window.localStorage.getItem('ip_env') || '' : '';
    const env =
      (storedEnv && storedEnv !== 'all' ? storedEnv : '') ||
      process.env.NEXT_PUBLIC_ENVIRONMENT ||
      'dev';
    if (env) headers['X-Environment'] = env;
    const workspace =
      typeof window !== 'undefined' ? window.localStorage.getItem('ip_workspace') : '';
    if (workspace) headers['X-Workspace-Id'] = workspace;

    let requestUrl = normalizedPath;
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && storedEnv && storedEnv !== 'all' && !normalizedPath.startsWith('http')) {
      if (!/[?&]environment=/.test(normalizedPath)) {
        requestUrl = `${normalizedPath}${normalizedPath.includes('?') ? '&' : '?'}environment=${encodeURIComponent(storedEnv)}`;
      }
    }

    const response = await fetch(requestUrl, {
      ...options,
      headers,
    });

    if (response.status === 401 && !options.skipAuth && !options._retry) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.request<T>(path, { ...options, _retry: true });
      }
      this.clearToken();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        const from = encodeURIComponent(window.location.pathname);
        window.location.href = `/login?from=${from}`;
      }
      throw new Error('Unauthorized');
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 429) {
        const wait = response.headers.get('Retry-After');
        throw new Error(data.error || (wait ? `请求过于频繁，请 ${wait} 秒后再试` : '请求过于频繁，请稍后再试'));
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data as T;
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();

// Auth API
export const authApi = {
  login: (data: { username: string; password: string }) =>
    apiClient.post<{ accessToken: string; refreshToken: string; user: any }>('/auth/login', data, { skipAuth: true }),
  logout: () => apiClient.post<{ success: boolean }>('/auth/logout'),
  me: () => apiClient.get<{ user: any }>('/auth/me'),
  refresh: (refreshToken: string) =>
    apiClient.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken }, { skipAuth: true }),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    apiClient.put<{ success: boolean }>('/auth/password', data),
};

// Users API
export const usersApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params).toString();
    return apiClient.get<any>(`/users${query ? `?${query}` : ''}`);
  },
  create: (data: any) => apiClient.post<any>('/users', data),
  get: (id: string) => apiClient.get<any>(`/users/${id}`),
  update: (id: string, data: any) => apiClient.put<any>(`/users/${id}`, data),
  delete: (id: string) => apiClient.delete<any>(`/users/${id}`),
};

// Roles API
export const rolesApi = {
  list: () => apiClient.get<any>('/roles'),
  create: (data: { code: string; name: string; description?: string; permissions?: string[]; status?: string }) =>
    apiClient.post<any>('/roles', data),
  update: (id: string, data: Record<string, unknown>) => apiClient.put<any>(`/roles/${id}`, data),
  delete: (id: string) => apiClient.delete<any>(`/roles/${id}`),
};

// Datasources API
export const datasourcesApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params).toString();
    return apiClient.get<any>(`/datasources${query ? `?${query}` : ''}`);
  },
  create: (data: any) => apiClient.post<any>('/datasources', data),
  get: (id: string) => apiClient.get<any>(`/datasources/${id}`),
  update: (id: string, data: any) => apiClient.put<any>(`/datasources/${id}`, data),
  delete: (id: string) => apiClient.delete<any>(`/datasources/${id}`),
    test: (data: any) => apiClient.post<any>('/datasources/test', data),
  testById: (id: string) => apiClient.post<any>(`/datasources/test?id=${id}`),
  inspect: (data: { id?: string; datasourceId?: string; table?: string }) =>
    apiClient.post<any>('/datasources/inspect', data),
};

// Jobs API
export const jobsApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params).toString();
    return apiClient.get<any>(`/jobs${query ? `?${query}` : ''}`);
  },
  create: (data: any) => apiClient.post<any>('/jobs', data),
  get: (id: string) => apiClient.get<any>(`/jobs/${id}`),
  update: (id: string, data: any) => apiClient.put<any>(`/jobs/${id}`, data),
  delete: (id: string) => apiClient.delete<any>(`/jobs/${id}`),
  trigger: (jobId: string) => apiClient.post<any>('/jobs/trigger', { jobId }),
  control: (jobId: string, action: 'start' | 'stop' | 'pause') =>
    apiClient.post<any>('/jobs/control', { jobId, action }),
  preview: (data: {
    datasourceId: string;
    table?: string;
    sourceConfig?: Record<string, unknown>;
    fieldMapping?: unknown[];
    filterCondition?: string;
    limit?: number;
  }) => apiClient.post<any>('/jobs/preview', data),
  resetWatermark: (jobId: string, watermarkValue?: string | null) =>
    apiClient.post<any>(`/jobs/${jobId}/reset-watermark`, { watermarkValue: watermarkValue ?? null }),
};

// Executions API
export const executionsApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params).toString();
    return apiClient.get<any>(`/executions${query ? `?${query}` : ''}`);
  },
  get: (id: string) => apiClient.get<any>(`/executions/${id}`),
};

// Dead Letters API
export const deadLettersApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params).toString();
    return apiClient.get<any>(`/dead-letters${query ? `?${query}` : ''}`);
  },
  get: (id: string, includeTarget = false) =>
    apiClient.get<any>(`/dead-letters?id=${encodeURIComponent(id)}${includeTarget ? '&includeTarget=true' : ''}`),
  batchAction: (ids: string[], action: 'reprocess' | 'ignore' | 'resolve', extra?: Record<string, unknown>) =>
    apiClient.post<any>('/dead-letters', { ids, action, ...(extra || {}) }),
  retry: (id: string) => apiClient.post<any>('/dead-letters', { ids: [id], action: 'reprocess' }),
  delete: (id: string) => apiClient.post<any>('/dead-letters', { ids: [id], action: 'ignore' }),
  resolve: (id: string, data: { payload?: Record<string, unknown>; winner?: string; execute?: boolean }) =>
    apiClient.post<any>('/dead-letters', { ids: [id], action: 'resolve', execute: true, ...data }),
};

// Dashboard API
export const dashboardApi = {
  stats: () => apiClient.get<any>('/dashboard/stats'),
};

// Audit Logs API
export const auditLogsApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params).toString();
    return apiClient.get<any>(`/audit-logs${query ? `?${query}` : ''}`);
  },
};

// Connectors API - 获取连接器元数据（类型列表、配置Schema等）
export const connectorsApi = {
  list: () => apiClient.get<ConnectorMetadata[]>('/connectors'),
  get: (type: string) => apiClient.get<ConnectorMetadata>(`/connectors/${type}`),
};

export interface ConnectorMetadata {
  type: string;
  name: string;
  category: 'database' | 'messaging' | 'api' | 'file' | 'saas';
  description: string;
  icon: string;
  sourceSupported: boolean;
  targetSupported: boolean;
  configSchema: ConfigSchema;
  features: {
    batchRead: boolean;
    incrementalRead: boolean;
    streamingRead: boolean;
    batchWrite: boolean;
    transactionalWrite: boolean;
    upsertSupport: boolean;
  };
}

// Applications API
export const appsApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<any>(`/apps${query ? `?${query}` : ''}`);
  },
  get: (id: string) => apiClient.get<any>(`/apps/${id}`),
  create: (data: any) => apiClient.post<any>('/apps', data),
  update: (id: string, data: any) => apiClient.put<any>(`/apps/${id}`, data),
  delete: (id: string) => apiClient.delete<any>(`/apps/${id}`),
  my: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<any>(`/apps/my${query ? `?${query}` : ''}`);
  },
  bindings: {
    list: (params?: Record<string, any>) => {
      const query = new URLSearchParams(params as any).toString();
      return apiClient.get<any>(`/apps/bindings${query ? `?${query}` : ''}`);
    },
    create: (data: any) => apiClient.post<any>('/apps/bindings', data),
    update: (id: string, data: any) => apiClient.put<any>(`/apps/bindings?id=${id}`, data),
    delete: (id: string) => apiClient.delete<any>(`/apps/bindings?id=${id}`),
  },
  ssoLogin: (appId: string, redirectUrl?: string) =>
    apiClient.post<any>('/sso/login', { appId, redirectUrl }),
};

// SSO Logs API
export const ssoLogsApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<any>(`/sso/logs${query ? `?${query}` : ''}`);
  },
};

// SSO Sessions API
export const ssoSessionsApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<any>(`/sso/sessions${query ? `?${query}` : ''}`);
  },
  revoke: (sessionId: string) =>
    apiClient.delete<any>(`/sso/sessions?sessionId=${sessionId}`),
  revokeAll: () =>
    apiClient.delete<any>('/sso/sessions?all=true'),
};

export const openApi = {
  catalog: () => apiClient.get<any>('/open/catalog'),
  connectors: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<any>(`/open/connectors${query ? `?${query}` : ''}`);
  },
  templates: () => apiClient.get<any>('/open/templates'),
  clients: {
    list: () => apiClient.get<any>('/open/clients'),
    create: (data: {
      name: string;
      code: string;
      description?: string;
      scopes?: string[];
      ipWhitelist?: string[];
      rateLimitPerMinute?: number;
      monthlyCallQuota?: number;
      monthlyRowQuota?: number;
      sandbox?: boolean;
      alertEmail?: string;
      alertWebhookUrl?: string;
      callbackUrl?: string;
    }) => apiClient.post<any>('/open/clients', data),
    update: (id: string, data: Record<string, unknown>) =>
      apiClient.put<any>(`/open/clients?id=${id}`, data),
    rotate: (id: string) => apiClient.post<any>('/open/clients/rotate', { id }),
    delete: (id: string) => apiClient.delete<any>(`/open/clients?id=${id}`),
  },
  identity: {
    pull: (data: { datasourceId: string; jobId?: string; syncOrg?: boolean; executeJob?: boolean }) =>
      apiClient.post<any>('/open/identity/pull', data),
  },
  rollback: (data: { jobId: string; snapshotId?: string; execute?: boolean }) =>
    apiClient.post<any>('/open/jobs/rollback', data),
  usage: (clientId?: string) =>
    apiClient.get<any>(`/open/usage${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`),
  status: () => apiClient.get<any>('/open/status'),
  errors: () => apiClient.get<any>('/open/errors'),
  changelog: () => apiClient.get<any>('/open/changelog'),
  workspaces: (clientId?: string) =>
    apiClient.get<any>(`/open/workspaces${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`),
  createWorkspace: (data: { name: string; code: string; clientId?: string; environment?: string }) =>
    apiClient.post<any>('/open/workspaces', data),
  promote: (data: { jobId: string; targetEnvironment?: string }) =>
    apiClient.post<any>('/open/jobs/promote', data),
  register: (data: { name: string; code: string; description?: string; inviteCode?: string }) =>
    apiClient.post<any>('/open/register', data),
  sdk: () => apiClient.get<any>('/open/sdk'),
  buildSdk: () => apiClient.post<any>('/open/sdk/build', {}),
  downloadSdkUrl: (filename: string) =>
    `${(process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api').replace(/\/+$/, '')}/open/sdk/download?file=${encodeURIComponent(filename)}`,
  // 白标嵌入（路径不挂 /open，独立签名模式）
  branding: (clientId: string) =>
    apiClient.get<any>(`/branding?clientId=${encodeURIComponent(clientId)}`),
  resetEmbedToken: (clientId?: string) =>
    apiClient.post<any>('/embed/token', clientId ? { clientId } : {}),
  sla: (days = 30, clientId?: string) =>
    apiClient.get<any>(`/status?days=${days}${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}`),
  // 账单与用量（tenant 隔离，非平台账号只看自己）
  billingPlans: () => apiClient.get<any>('/billing/plans'),
  invoices: (month?: string) =>
    apiClient.get<any>(`/invoices${month ? `?month=${month}` : ''}`),
  previewInvoice: (clientId?: string) =>
    apiClient.post<any>('/invoices', { action: 'preview', ...(clientId ? { clientId } : {}) }),
  generateInvoice: (month: string, clientId?: string) =>
    apiClient.post<any>('/invoices', { action: 'generate', month, ...(clientId ? { clientId } : {}) }),
  // 账单状态流转：action=void(作废) / pay(标记已支付)
  invoiceAction: (action: 'void' | 'pay', invoiceId: string, reason?: string) =>
    apiClient.post<any>('/invoices', { action, invoiceId, ...(reason ? { reason } : {}) }),
  // 套餐创建 / 更新 / 归档
  createPlan: (payload: Record<string, any>) =>
    apiClient.post<any>('/billing/plans', payload),
  updatePlan: (planId: string, payload: Record<string, any>) =>
    apiClient.put<any>(`/billing/plans/${encodeURIComponent(planId)}`, payload),
  archivePlan: (planId: string) =>
    apiClient.delete<any>(`/billing/plans/${encodeURIComponent(planId)}`),
  // 账单 PDF（带鉴权拉 blob，再由页面触发下载）
  downloadInvoicePdf: async (invoiceId: string): Promise<Blob> => {
    const token = apiClient.getToken();
    const resp = await fetch(`${BASE_URL}/invoices/${encodeURIComponent(invoiceId)}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error(`PDF 下载失败（${resp.status}）`);
    return resp.blob();
  },
};

export const snapshotsApi = {
  list: (jobId: string) => apiClient.get<any>(`/version-snapshots?jobId=${encodeURIComponent(jobId)}`),
  rollback: (data: { jobId: string; snapshotId?: string; targetVersion?: number; execute?: boolean }) =>
    apiClient.post<any>('/version-snapshots', data),
};

export const workflowsApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<any>(`/workflows${query ? `?${query}` : ''}`);
  },
  get: (id: string) => apiClient.get<any>(`/workflows?id=${encodeURIComponent(id)}`),
};

export const orgDepartmentsApi = {
  tree: (jobId: string) =>
    apiClient.get<any>(`/org-departments?jobId=${encodeURIComponent(jobId)}&tree=true`),
  list: (jobId: string) =>
    apiClient.get<any>(`/org-departments?jobId=${encodeURIComponent(jobId)}`),
  users: (jobId: string, deptSourceId: string, includeSub = true) =>
    apiClient.get<any>(
      `/org-departments?jobId=${encodeURIComponent(jobId)}&users=${encodeURIComponent(deptSourceId)}${includeSub ? '&includeSub=true' : ''}`,
    ),
};

export const fieldAuditApi = {
  list: (params?: Record<string, any>) => {
    const query = new URLSearchParams(params as any).toString();
    return apiClient.get<any>(`/field-audit${query ? `?${query}` : ''}`);
  },
  get: (id: string) => apiClient.get<any>(`/field-audit?id=${encodeURIComponent(id)}`),
};
