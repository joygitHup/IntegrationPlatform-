'use client';

const BASE_URL = '/api';

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiClient {
  private token: string | null = null;

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

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
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

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401 && !options.skipAuth) {
      this.clearToken();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
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
  me: () => apiClient.get<{ user: any }>('/auth/me'),
  refresh: (refreshToken: string) =>
    apiClient.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken }, { skipAuth: true }),
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
  list: () => apiClient.get<any[]>('/roles'),
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
  batchAction: (ids: string[], action: 'reprocess' | 'ignore') =>
    apiClient.post<any>('/dead-letters', { ids, action }),
  retry: (id: string) => apiClient.post<any>('/dead-letters', { ids: [id], action: 'reprocess' }),
  delete: (id: string) => apiClient.post<any>('/dead-letters', { ids: [id], action: 'ignore' }),
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
  configSchema: {
    fields: Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
      defaultValue?: any;
      placeholder?: string;
      help?: string;
      group?: string;
      options?: Array<{ value: string; label: string }>;
      sensitive?: boolean;
      showWhen?: { field: string; value: string };
    }>;
  };
  features: {
    batchRead: boolean;
    incrementalRead: boolean;
    streamingRead: boolean;
    batchWrite: boolean;
    transactionalWrite: boolean;
    upsertSupport: boolean;
  };
}
