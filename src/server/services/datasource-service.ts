import { getDb } from '@/server/db';
import { datasources, type NewDatasource, type Datasource } from '@/server/db/schema/datasource';
import { generateId } from '@/server/utils/id';
import { encrypt, decrypt, maskSensitive } from '@/server/utils/encryption';
import { eq } from 'drizzle-orm';

// 需要加密存储的敏感字段路径（按数据源类型）
const SENSITIVE_FIELDS: Record<string, string[]> = {
  mysql: ['password'],
  postgres: ['password'],
  http_api: ['token', 'apiKeyValue'],
  rabbitmq: ['password'],
  kafka: ['password', 'saslPassword'],
  redis: ['password'],
};

/**
 * 加密配置中的敏感字段
 */
function encryptConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const fields = SENSITIVE_FIELDS[type] || [];
  const result = { ...config };
  for (const field of fields) {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = encrypt(result[field] as string);
    }
  }
  return result;
}

/**
 * 解密配置中的敏感字段
 */
function decryptConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const fields = SENSITIVE_FIELDS[type] || [];
  const result = { ...config };
  for (const field of fields) {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = decrypt(result[field] as string);
    }
  }
  return result;
}

/**
 * 脱敏配置（用于列表展示）
 */
function maskConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  const fields = SENSITIVE_FIELDS[type] || [];
  const result = { ...config };
  for (const field of fields) {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = maskSensitive(result[field] as string);
    }
  }
  return result;
}

// ============================================================
// CRUD
// ============================================================
export async function listDatasources(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
  status?: string;
}) {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const all = await db.select().from(datasources).orderBy(datasources.createdAt);
  let filtered = [...all].reverse();

  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    filtered = filtered.filter(
      (d) => d.name.toLowerCase().includes(kw) || d.code.toLowerCase().includes(kw),
    );
  }
  if (params.type) filtered = filtered.filter((d) => d.type === params.type);
  if (params.status) filtered = filtered.filter((d) => d.status === params.status);

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSize).map((d) => ({
    ...d,
    config: maskConfig(d.type, d.config as Record<string, unknown>),
  }));

  return { items, total, page, pageSize };
}

export async function getDatasourceById(id: string, decryptFields = false) {
  const db = getDb();
  const result = await db.select().from(datasources).where(eq(datasources.id, id)).limit(1);
  if (result.length === 0) return null;

  const ds = result[0];
  if (decryptFields) {
    return { ...ds, config: decryptConfig(ds.type, ds.config as Record<string, unknown>) };
  }
  return { ...ds, config: maskConfig(ds.type, ds.config as Record<string, unknown>) };
}

export async function getDatasourceByCode(code: string, decryptFields = false) {
  const db = getDb();
  const result = await db.select().from(datasources).where(eq(datasources.code, code)).limit(1);
  if (result.length === 0) return null;

  const ds = result[0];
  if (decryptFields) {
    return { ...ds, config: decryptConfig(ds.type, ds.config as Record<string, unknown>) };
  }
  return ds;
}

export async function createDatasource(input: {
  name: string;
  code: string;
  type: string;
  config: Record<string, unknown>;
  description?: string;
  createdBy: string;
}) {
  const db = getDb();

  // 检查 code 是否已存在
  const existing = await getDatasourceByCode(input.code);
  if (existing) {
    throw new Error(`数据源编码 ${input.code} 已存在`);
  }

  const encryptedConfig = encryptConfig(input.type, input.config);

  const ds: NewDatasource = {
    id: generateId('ds'),
    name: input.name,
    code: input.code,
    type: input.type,
    config: encryptedConfig,
    description: input.description,
    createdBy: input.createdBy,
    status: 'active',
  };

  await db.insert(datasources).values(ds);
  return getDatasourceById(ds.id);
}

export async function updateDatasource(id: string, input: Partial<{
  name: string;
  type: string;
  config: Record<string, unknown>;
  description: string;
  status: string;
}>) {
  const db = getDb();
  const existing = await getDatasourceById(id, true);
  if (!existing) throw new Error('数据源不存在');

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) updateData.name = input.name;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.status !== undefined) updateData.status = input.status;

  if (input.config) {
    const type = input.type || existing.type;
    updateData.config = encryptConfig(type, input.config);
  }

  await db.update(datasources).set(updateData).where(eq(datasources.id, id));
  return getDatasourceById(id);
}

export async function deleteDatasource(id: string) {
  const db = getDb();
  await db.delete(datasources).where(eq(datasources.id, id));
}

// ============================================================
// 连通性测试
// ============================================================
export async function testConnection(input: {
  type: string;
  config: Record<string, unknown>;
}): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  const startTime = Date.now();
  const { type, config: dsConfig } = input;

  try {
    switch (type) {
      case 'http_api': {
        const baseUrl = (dsConfig as Record<string, unknown>).baseUrl as string | undefined;
        if (!baseUrl) {
          return { success: false, message: '缺少 baseUrl 配置' };
        }
        // 简单探测：发送 HEAD 请求
        const controller = new AbortController();
        const timeoutMs = ((dsConfig as Record<string, unknown>).timeoutMs as number) || 5000;
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(baseUrl, {
            method: 'HEAD',
            signal: controller.signal,
            headers: buildAuthHeaders(dsConfig as Record<string, string>),
          });
          clearTimeout(timeout);
          const latency = Date.now() - startTime;
          return {
            success: response.ok || response.status === 405 || response.status === 401,
            message: `连接成功，HTTP ${response.status}`,
            latencyMs: latency,
          };
        } catch (fetchError) {
          clearTimeout(timeout);
          return { success: false, message: `连接失败: ${(fetchError as Error).message}` };
        }
      }

      case 'mysql':
      case 'postgres': {
        const { host, port } = dsConfig as { host?: string; port?: number };
        if (!host || !port) {
          return { success: false, message: '缺少主机或端口配置' };
        }
        // 简单 TCP 探测（Node.js 环境）
        const net = await import('node:net');
        return new Promise((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(5000);
          socket.connect(port, host, () => {
            const latency = Date.now() - startTime;
            socket.destroy();
            resolve({ success: true, message: `连接成功（TCP 握手正常）`, latencyMs: latency });
          });
          socket.on('error', (err) => {
            socket.destroy();
            resolve({ success: false, message: `连接失败: ${err.message}` });
          });
          socket.on('timeout', () => {
            socket.destroy();
            resolve({ success: false, message: '连接超时' });
          });
        });
      }

      case 'redis': {
        const { host, port } = dsConfig as { host?: string; port?: number };
        if (!host || !port) {
          return { success: false, message: '缺少主机或端口配置' };
        }
        const net = await import('node:net');
        return new Promise((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(5000);
          socket.connect(port, host, () => {
            const latency = Date.now() - startTime;
            socket.destroy();
            resolve({ success: true, message: `连接成功（TCP 握手正常）`, latencyMs: latency });
          });
          socket.on('error', (err) => {
            socket.destroy();
            resolve({ success: false, message: `连接失败: ${err.message}` });
          });
          socket.on('timeout', () => {
            socket.destroy();
            resolve({ success: false, message: '连接超时' });
          });
        });
      }

      case 'rabbitmq':
      case 'kafka': {
        const { host, port } = dsConfig as { host?: string; port?: number };
        if (!host || !port) {
          return { success: false, message: '缺少主机或端口配置' };
        }
        const net = await import('node:net');
        return new Promise((resolve) => {
          const socket = new net.Socket();
          socket.setTimeout(5000);
          socket.connect(port, host, () => {
            const latency = Date.now() - startTime;
            socket.destroy();
            resolve({ success: true, message: `连接成功（TCP 握手正常）`, latencyMs: latency });
          });
          socket.on('error', (err) => {
            socket.destroy();
            resolve({ success: false, message: `连接失败: ${err.message}` });
          });
          socket.on('timeout', () => {
            socket.destroy();
            resolve({ success: false, message: '连接超时' });
          });
        });
      }

      default:
        return { success: false, message: `不支持的数据源类型: ${type}` };
    }
  } catch (error) {
    return {
      success: false,
      message: `测试异常: ${(error as Error).message}`,
    };
  }
}

function buildAuthHeaders(config: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  const authType = config.authType;
  switch (authType) {
    case 'bearer':
      if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
      break;
    case 'basic':
      if (config.username && config.password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
      }
      break;
    case 'apikey':
      if (config.apiKeyHeader && config.apiKeyValue) {
        headers[config.apiKeyHeader] = config.apiKeyValue;
      }
      break;
  }
  return headers;
}
