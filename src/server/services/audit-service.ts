import { getDb } from '@/server/db';
import { auditLogs, type NewAuditLog } from '@/server/db/schema/audit-log';
import { generateId, generateTraceId } from '@/server/utils/id';

export interface AuditLogInput {
  userId?: string;
  username?: string;
  action: 'LOGIN' | 'LOGOUT' | 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE' | 'APPROVE';
  resourceType?: 'JOB' | 'DATASOURCE' | 'USER' | 'APP' | 'ROLE' | 'SETTING';
  resourceId?: string;
  resourceName?: string;
  detail?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  traceId?: string;
}

/**
 * 记录审计日志
 */
export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  const db = getDb();
  const log: NewAuditLog = {
    id: generateId('audit'),
    traceId: input.traceId || generateTraceId(),
    ...input,
  };
  await db.insert(auditLogs).values(log);
}

/**
 * 分页查询审计日志
 */
export async function listAuditLogs(params: {
  page?: number;
  pageSize?: number;
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startTime?: number;
  endTime?: number;
}) {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  // SQLite 下用简单查询
  let query = db.select().from(auditLogs).$dynamic();

  // 排序
  // 由于 drizzle 动态查询复杂性，这里用简单方式
  const all = await db.select().from(auditLogs).orderBy(auditLogs.createdAt);

  // 简单内存过滤（开发环境数据量小）
  let filtered = [...all].reverse();
  if (params.userId) filtered = filtered.filter((x) => x.userId === params.userId);
  if (params.action) filtered = filtered.filter((x) => x.action === params.action);
  if (params.resourceType) filtered = filtered.filter((x) => x.resourceType === params.resourceType);
  if (params.resourceId) filtered = filtered.filter((x) => x.resourceId === params.resourceId);
  if (params.startTime) filtered = filtered.filter((x) => (x.createdAt?.getTime() || 0) >= params.startTime!);
  if (params.endTime) filtered = filtered.filter((x) => (x.createdAt?.getTime() || 0) <= params.endTime!);

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSize);

  return { items, total, page, pageSize };
}
