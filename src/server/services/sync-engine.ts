/**
 * 同步引擎 - 负责去重判断、冲突解决、变更审计
 */
import { getDb } from '@/server/db';
import {
  fieldChangeAudits,
  type FieldChange,
  type NewFieldChangeAudit,
} from '@/server/db/schema/job-execution';
import { generateId } from '@/server/utils/id';
import { computeDataFingerprint } from './desensitize-service';
import { eq, and } from 'drizzle-orm';

export type ConflictStrategy = 'source_wins' | 'target_wins' | 'newest_wins' | 'manual';
export type WriteMode = 'insert' | 'upsert' | 'update_only';
export type SyncOperation = 'create' | 'update' | 'delete' | 'skip_conflict' | 'skip_identical';

export interface SyncDecision {
  operation: SyncOperation;
  reason: string;
  // 对于 update，返回需要更新的字段
  changedFields?: FieldChange[];
  // 对于 manual 冲突，标记需要人工介入
  requireManual?: boolean;
}

export interface SyncRecordContext {
  jobId: string;
  executionId: string;
  sourceRecord: Record<string, unknown>;
  targetRecord?: Record<string, unknown> | null;
  matchKeys: string[];
  conflictStrategy: ConflictStrategy;
  conflictCompareField?: string;
  enableChangeAudit: boolean;
}

// ============================================================
// 生成匹配键值（用于唯一标识一条记录）
// ============================================================
export function buildRecordKey(record: Record<string, unknown>, matchKeys: string[]): string {
  if (!matchKeys || matchKeys.length === 0) {
    return computeDataFingerprint(record);
  }

  if (matchKeys.length === 1) {
    return String(record[matchKeys[0]] ?? '');
  }

  // 多匹配键：用 | 拼接
  return matchKeys.map((k) => String(record[k] ?? '')).join('|');
}

// ============================================================
// 判断两条记录是否完全相同
// ============================================================
export function isRecordIdentical(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  ignoreFields: string[] = [],
): boolean {
  const ignoreSet = new Set(ignoreFields);
  const allKeys = new Set([...Object.keys(source), ...Object.keys(target)]);

  for (const key of allKeys) {
    if (ignoreSet.has(key)) continue;

    const sVal = source[key];
    const tVal = target[key];

    // 都不存在或都为 null/undefined → 相同
    if (sVal === undefined && tVal === undefined) continue;
    if (sVal === null && tVal === null) continue;

    // 类型不同 → 不同
    if (typeof sVal !== typeof tVal) {
      // 特例：null vs undefined 视为相同
      if ((sVal === null || sVal === undefined) && (tVal === null || tVal === undefined)) {
        continue;
      }
      return false;
    }

    // 对象/数组 用 JSON 比较
    if (typeof sVal === 'object' && sVal !== null) {
      if (JSON.stringify(sVal) !== JSON.stringify(tVal)) {
        return false;
      }
      continue;
    }

    if (sVal !== tVal) {
      return false;
    }
  }

  return true;
}

// ============================================================
// 计算字段差异
// ============================================================
export function computeFieldChanges(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  mappedFields: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  const compareFields = mappedFields.length > 0 ? mappedFields : Object.keys(source);

  for (const field of compareFields) {
    const oldValue = target[field];
    const newValue = source[field];

    if (oldValue === newValue) continue;

    // null / undefined 视为相同
    if ((oldValue === null || oldValue === undefined) && (newValue === null || newValue === undefined)) {
      continue;
    }

    // 对象深度比较
    if (typeof oldValue === 'object' && oldValue !== null &&
        typeof newValue === 'object' && newValue !== null) {
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    }

    changes.push({ field, oldValue, newValue });
  }

  return changes;
}

// ============================================================
// 同步决策引擎：判断对一条记录执行什么操作
// ============================================================
export function makeSyncDecision(ctx: SyncRecordContext): SyncDecision {
  const { sourceRecord, targetRecord, matchKeys, conflictStrategy, conflictCompareField } = ctx;

  // 目标不存在 → 创建
  if (!targetRecord) {
    return { operation: 'create', reason: 'TARGET_NOT_FOUND' };
  }

  // 目标存在 → 检查是否需要更新
  // 先比较是否完全相同
  const isIdentical = isRecordIdentical(sourceRecord, targetRecord, [
    ...(matchKeys || []), // 匹配键必然相同，跳过
    'updated_at', 'created_at', 'updatedAt', 'createdAt', // 时间戳跳过
  ]);

  if (isIdentical) {
    return { operation: 'skip_identical', reason: 'IDENTICAL_RECORD' };
  }

  // 有差异 → 按冲突策略决定
  switch (conflictStrategy) {
    case 'source_wins':
      return {
        operation: 'update',
        reason: 'CONFLICT_SOURCE_WINS',
        changedFields: computeFieldChanges(sourceRecord, targetRecord, []),
      };

    case 'target_wins':
      return { operation: 'skip_conflict', reason: 'CONFLICT_TARGET_WINS' };

    case 'newest_wins': {
      if (!conflictCompareField) {
        // 没配置比较字段 → 退化为 source_wins
        return {
          operation: 'update',
          reason: 'CONFLICT_SOURCE_WINS_NO_COMPARE_FIELD',
          changedFields: computeFieldChanges(sourceRecord, targetRecord, []),
        };
      }
      const sourceTime = new Date(String(sourceRecord[conflictCompareField] || 0)).getTime();
      const targetTime = new Date(String(targetRecord[conflictCompareField] || 0)).getTime();

      if (sourceTime >= targetTime) {
        return {
          operation: 'update',
          reason: 'CONFLICT_NEWEST_WINS_SOURCE_NEWER',
          changedFields: computeFieldChanges(sourceRecord, targetRecord, []),
        };
      } else {
        return { operation: 'skip_conflict', reason: 'CONFLICT_NEWEST_WINS_TARGET_NEWER' };
      }
    }

    case 'manual':
      return {
        operation: 'skip_conflict',
        reason: 'CONFLICT_MANUAL_REQUIRED',
        requireManual: true,
      };

    default:
      return {
        operation: 'update',
        reason: 'CONFLICT_DEFAULT_SOURCE_WINS',
        changedFields: computeFieldChanges(sourceRecord, targetRecord, []),
      };
  }
}

// ============================================================
// 记录字段级变更审计
// ============================================================
export async function recordFieldChangeAudit(params: {
  jobId: string;
  executionId: string;
  recordKey: string;
  operation: 'create' | 'update' | 'delete' | 'skip_conflict';
  changes: FieldChange[];
  beforeRecord?: Record<string, unknown> | null;
  afterRecord?: Record<string, unknown> | null;
}): Promise<void> {
  const db = getDb();

  const audit: NewFieldChangeAudit = {
    id: generateId('fca'),
    jobId: params.jobId,
    executionId: params.executionId,
    recordKey: params.recordKey,
    operation: params.operation,
    changes: params.changes,
    beforeHash: params.beforeRecord ? computeDataFingerprint(params.beforeRecord) : undefined,
    afterHash: params.afterRecord ? computeDataFingerprint(params.afterRecord) : undefined,
  };

  await db.insert(fieldChangeAudits).values(audit);
}

// ============================================================
// 查询字段变更审计记录
// ============================================================
export async function listFieldChangeAudits(params: {
  jobId?: string;
  executionId?: string;
  recordKey?: string;
  operation?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ items: typeof fieldChangeAudits.$inferSelect[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const conditions = [];
  if (params.jobId) conditions.push(eq(fieldChangeAudits.jobId, params.jobId));
  if (params.executionId) conditions.push(eq(fieldChangeAudits.executionId, params.executionId));
  if (params.recordKey) conditions.push(eq(fieldChangeAudits.recordKey, params.recordKey));
  if (params.operation) conditions.push(eq(fieldChangeAudits.operation, params.operation));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db.select().from(fieldChangeAudits)
    .where(where)
    .orderBy(fieldChangeAudits.createdAt)
    .limit(pageSize)
    .offset(offset);

  const totalResult = await db.select({ count: fieldChangeAudits.id })
    .from(fieldChangeAudits)
    .where(where);
  const total = totalResult.length;

  return { items, total, page, pageSize };
}
