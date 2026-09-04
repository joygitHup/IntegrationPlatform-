import { desc, eq, and, asc, sql, count, gt, lt } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { fieldChangeAudits } from '@/server/db/schema';
import { generateId } from '@/server/utils/id';
import { desensitizeRecord, type DesensitizeMode } from './desensitize-service';

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface RecordFieldAuditParams {
  jobId: string;
  executionId: string;
  recordKey: string;
  operation: 'create' | 'update' | 'delete';
  changes: FieldChange[];
  beforeRecord: Record<string, unknown> | null;
  afterRecord: Record<string, unknown> | null;
  entityType?: string;
  operatorId?: string;
  sensitiveFields?: string[];
  desensitizeMode?: DesensitizeMode;
}

// 记录字段级变更审计
export async function recordFieldChangeAudit(params: RecordFieldAuditParams) {
  const db = getDb();

  // 敏感字段脱敏
  let beforeData = params.beforeRecord;
  let afterData = params.afterRecord;
  let changes = params.changes;

  if (params.sensitiveFields && params.sensitiveFields.length > 0) {
    const mode = params.desensitizeMode || 'mask';
    if (beforeData) beforeData = desensitizeRecord(beforeData, params.sensitiveFields, mode);
    if (afterData) afterData = desensitizeRecord(afterData, params.sensitiveFields, mode);
    changes = changes.map((c) => {
      if (params.sensitiveFields!.includes(c.field)) {
        return {
          ...c,
          oldValue: c.oldValue != null ? '***' : null,
          newValue: c.newValue != null ? '***' : null,
        };
      }
      return c;
    });
  }

  const id = generateId('audit_field');
  await db.insert(fieldChangeAudits).values({
    id,
    jobId: params.jobId,
    executionId: params.executionId,
    entityType: params.entityType || 'record',
    recordKey: params.recordKey,
    operation: params.operation,
    changedFields: changes.map(c => c.field) as unknown as string,
    oldValues: params.beforeRecord as unknown as string | null,
    newValues: params.afterRecord as unknown as string | null,
    operatorId: params.operatorId || null,
  } as any);

  return id;
}

// 查询字段变更审计列表
export async function listFieldAuditLogs(params: {
  jobId?: string;
  executionId?: string;
  recordKey?: string;
  operation?: 'create' | 'update' | 'delete';
  page?: number;
  pageSize?: number;
}) {
  const db = getDb();
  const { jobId, executionId, recordKey, operation, page = 1, pageSize = 20 } = params;

  const conditions = [];
  if (jobId) conditions.push(eq(fieldChangeAudits.jobId, jobId));
  if (executionId) conditions.push(eq(fieldChangeAudits.executionId, executionId));
  if (recordKey) conditions.push(eq(fieldChangeAudits.recordKey, recordKey));
  if (operation) conditions.push(eq(fieldChangeAudits.operation, operation));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db
    .select({ value: count() })
    .from(fieldChangeAudits)
    .where(where);

  const total = totalResult?.value ?? 0;
  const offset = (page - 1) * pageSize;

  const items = await db
    .select()
    .from(fieldChangeAudits)
    .where(where)
    .orderBy(desc(fieldChangeAudits.createdAt))
    .limit(pageSize)
    .offset(offset);

  return { items, total, page, pageSize };
}

// 按执行 ID 查询
export async function listFieldAuditByExecution(
  executionId: string,
  opts: { page?: number; pageSize?: number } = {},
) {
  return listFieldAuditLogs({
    executionId,
    page: opts.page || 1,
    pageSize: opts.pageSize || 20,
  });
}

// 获取单条审计记录
export async function getFieldAuditLog(id: string) {
  const db = getDb();
  const records = await db
    .select()
    .from(fieldChangeAudits)
    .where(eq(fieldChangeAudits.id, id))
    .limit(1);
  return records[0] || null;
}

// 获取某条记录的变更历史（时间线）
export async function getRecordChangeHistory(
  jobId: string,
  recordKey: string,
  opts: { page?: number; pageSize?: number } = {},
) {
  return listFieldAuditLogs({
    jobId,
    recordKey,
    page: opts.page || 1,
    pageSize: opts.pageSize || 20,
  });
}

// 统计变更分布
export async function getFieldAuditStats(jobId: string, startTime?: Date, endTime?: Date) {
  const db = getDb();
  const conditions = [eq(fieldChangeAudits.jobId, jobId)];
  if (startTime) conditions.push(gt(fieldChangeAudits.createdAt, startTime));
  if (endTime) conditions.push(lt(fieldChangeAudits.createdAt, endTime));

  const where = and(...conditions);

  // 按操作类型统计
  const byOp = db.$with('by_op').as(
    db
      .select({
        operation: fieldChangeAudits.operation,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(fieldChangeAudits)
      .where(where)
      .groupBy(fieldChangeAudits.operation),
  );

  const result = await db.with(byOp).select().from(byOp);

  const stats: Record<string, number> = {
    create: 0,
    update: 0,
    delete: 0,
  };
  for (const row of result) {
    stats[row.operation as string] = Number(row.count);
  }

  // 总变更字段数
  const [total] = await db
    .select({ changes: sql<number>`sum(change_count)` })
    .from(fieldChangeAudits)
    .where(where);

  return {
    byOperation: stats,
    totalChanges: total?.changes ?? 0,
  };
}
