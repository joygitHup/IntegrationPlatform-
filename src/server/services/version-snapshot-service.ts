/**
 * 数据版本快照与回滚服务
 */
import { getDb } from '@/server/db';
import {
  dataVersionSnapshots,
  type NewDataVersionSnapshot,
} from '@/server/db/schema/job-execution';
import { generateId } from '@/server/utils/id';
import { eq, and, desc } from 'drizzle-orm';

// ============================================================
// 创建版本快照
// ============================================================
export async function createSnapshot(params: {
  jobId: string;
  executionId: string;
  snapshotType: 'before' | 'after';
  data: Record<string, unknown>[];
  retentionDays?: number;
}): Promise<string> {
  const db = getDb();
  const retentionDays = params.retentionDays || 30;

  // 计算当前最大版本号
  const latest = await db.select({ version: dataVersionSnapshots.version })
    .from(dataVersionSnapshots)
    .where(and(
      eq(dataVersionSnapshots.jobId, params.jobId),
      eq(dataVersionSnapshots.snapshotType, params.snapshotType),
    ))
    .orderBy(desc(dataVersionSnapshots.version))
    .limit(1);

  const nextVersion = (latest[0]?.version || 0) + 1;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + retentionDays);

  const snapshot: NewDataVersionSnapshot = {
    id: generateId('snap'),
    jobId: params.jobId,
    executionId: params.executionId,
    version: nextVersion,
    snapshotType: params.snapshotType,
    recordCount: params.data.length,
    snapshotData: params.data,
    expiresAt,
  };

  await db.insert(dataVersionSnapshots).values(snapshot);

  // 清理过期快照
  await cleanupExpiredSnapshots(params.jobId);

  return snapshot.id;
}

// ============================================================
// 获取快照列表
// ============================================================
export async function listSnapshots(params: {
  jobId: string;
  snapshotType?: 'before' | 'after';
  page?: number;
  pageSize?: number;
}): Promise<{ items: typeof dataVersionSnapshots.$inferSelect[]; total: number }> {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(dataVersionSnapshots.jobId, params.jobId)];
  if (params.snapshotType) {
    conditions.push(eq(dataVersionSnapshots.snapshotType, params.snapshotType));
  }

  const items = await db.select().from(dataVersionSnapshots)
    .where(and(...conditions))
    .orderBy(desc(dataVersionSnapshots.version))
    .limit(pageSize)
    .offset(offset);

  const all = await db.select({ id: dataVersionSnapshots.id })
    .from(dataVersionSnapshots)
    .where(and(...conditions));
  const total = all.length;

  return { items, total };
}

// ============================================================
// 获取指定版本的快照数据
// ============================================================
export async function getSnapshotData(snapshotId: string): Promise<Record<string, unknown>[] | null> {
  const db = getDb();

  const result = await db.select().from(dataVersionSnapshots)
    .where(eq(dataVersionSnapshots.id, snapshotId))
    .limit(1);

  if (result.length === 0) return null;
  return result[0].snapshotData;
}

// ============================================================
// 生成回滚计划
// ============================================================
export async function generateRollbackPlan(params: {
  jobId: string;
  targetVersion: number;
  snapshotType?: 'before' | 'after';
}): Promise<{
  snapshotId: string | null;
  recordCount: number;
  estimatedOperations: {
    creates: number;
    updates: number;
    deletes: number;
  };
}> {
  const db = getDb();
  const snapType = params.snapshotType || 'before';

  // 获取目标版本快照
  const targetSnap = await db.select().from(dataVersionSnapshots)
    .where(and(
      eq(dataVersionSnapshots.jobId, params.jobId),
      eq(dataVersionSnapshots.snapshotType, snapType),
      eq(dataVersionSnapshots.version, params.targetVersion),
    ))
    .limit(1);

  if (targetSnap.length === 0) {
    return {
      snapshotId: null,
      recordCount: 0,
      estimatedOperations: { creates: 0, updates: 0, deletes: 0 },
    };
  }

  // 获取最新版本快照
  const latestSnap = await db.select().from(dataVersionSnapshots)
    .where(and(
      eq(dataVersionSnapshots.jobId, params.jobId),
      eq(dataVersionSnapshots.snapshotType, snapType),
    ))
    .orderBy(desc(dataVersionSnapshots.version))
    .limit(1);

  if (latestSnap.length === 0) {
    return {
      snapshotId: targetSnap[0].id,
      recordCount: targetSnap[0].recordCount,
      estimatedOperations: { creates: targetSnap[0].recordCount, updates: 0, deletes: 0 },
    };
  }

  // 简化估算：假设目标版本记录数全部需要恢复
  // 真实场景需要逐条对比，但这里先给粗略估计
  return {
    snapshotId: targetSnap[0].id,
    recordCount: targetSnap[0].recordCount,
    estimatedOperations: {
      creates: Math.max(0, targetSnap[0].recordCount - latestSnap[0].recordCount),
      updates: Math.min(targetSnap[0].recordCount, latestSnap[0].recordCount),
      deletes: Math.max(0, latestSnap[0].recordCount - targetSnap[0].recordCount),
    },
  };
}

// ============================================================
// 清理过期快照
// ============================================================
export async function cleanupExpiredSnapshots(jobId?: string): Promise<number> {
  const db = getDb();
  const now = new Date();

  let deletedCount = 0;

  // SQLite 不支持 delete with limit，先查询再删
  const expired = await db.select({ id: dataVersionSnapshots.id })
    .from(dataVersionSnapshots)
    .where(and(
      jobId ? eq(dataVersionSnapshots.jobId, jobId) : undefined,
      dataVersionSnapshots.expiresAt ? undefined : undefined,
    ))
    .limit(100); // 分批清理

  for (const snap of expired) {
    const snapRecord = await db.select({ expiresAt: dataVersionSnapshots.expiresAt })
      .from(dataVersionSnapshots)
      .where(eq(dataVersionSnapshots.id, snap.id))
      .limit(1);

    if (snapRecord[0]?.expiresAt && new Date(snapRecord[0].expiresAt as Date) < now) {
      await db.delete(dataVersionSnapshots).where(eq(dataVersionSnapshots.id, snap.id));
      deletedCount++;
    }
  }

  return deletedCount;
}

// ============================================================
// 删除快照
// ============================================================
export async function deleteSnapshot(snapshotId: string): Promise<void> {
  const db = getDb();
  await db.delete(dataVersionSnapshots).where(eq(dataVersionSnapshots.id, snapshotId));
}
