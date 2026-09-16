export class IntegrationHubError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status = 0, payload?: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export class IntegrationHub {
  constructor(
    private opts: {
      apiKey: string;
      baseUrl?: string;
      environment?: string;
      workspaceId?: string;
    },
  ) {}

  private get baseUrl() {
    return (this.opts.baseUrl || 'http://127.0.0.1:8000/api').replace(/\/+$/, '');
  }

  async request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Environment': this.opts.environment || 'dev',
        ...(this.opts.apiKey ? { 'X-Api-Key': this.opts.apiKey } : {}),
        ...(this.opts.workspaceId ? { 'X-Workspace-Id': this.opts.workspaceId } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new IntegrationHubError(data.error || `HTTP ${res.status}`, res.status, data);
    }
    return data as T;
  }

  static register(opts: {
    name: string;
    code: string;
    baseUrl?: string;
    inviteCode?: string;
    description?: string;
  }) {
    const hub = new IntegrationHub({ apiKey: '', baseUrl: opts.baseUrl });
    return hub.request('POST', '/open/register', {
      name: opts.name,
      code: opts.code,
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.inviteCode ? { inviteCode: opts.inviteCode } : {}),
    });
  }

  catalog() {
    return this.request('GET', '/open/catalog');
  }

  sdk() {
    return this.request('GET', '/open/sdk');
  }

  me() {
    return this.request('GET', '/open/me');
  }

  datasources() {
    return this.request('GET', '/open/datasources');
  }

  jobs() {
    return this.request('GET', '/open/jobs');
  }

  inspect(datasourceId: string, table = '') {
    return this.request('POST', '/open/datasources/inspect', { datasourceId, table });
  }

  triggerJob(jobId: string) {
    return this.request('POST', '/open/jobs/trigger', { jobId });
  }

  ingest(jobId: string, records?: unknown[], idempotencyKey?: string) {
    return this.request(
      'POST',
      '/open/jobs/ingest',
      { jobId, ...(records ? { records } : {}) },
      idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
    );
  }
}
