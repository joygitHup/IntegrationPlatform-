import { getDb } from '@/server/db';
import { integrationJobs, type NewIntegrationJob, type IntegrationJob } from '@/server/db/schema/integration-job';
import { generateId } from '@/server/utils/id';
import { eq, and } from 'drizzle-orm';
import { validateMappings } from './field-mapping-engine';

// ============================================================
// CRUD
// ============================================================
export async function listJobs(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  syncMode?: string;
  sourceDatasourceId?: string;
  targetDatasourceId?: string;
}) {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const all = await db.select().from(integrationJobs).orderBy(integrationJobs.createdAt);
  let filtered = [...all].reverse();

  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    filtered = filtered.filter(
      (j) => j.name.toLowerCase().includes(kw) || j.code.toLowerCase().includes(kw),
    );
  }
  if (params.status) filtered = filtered.filter((j) => j.status === params.status);
  if (params.syncMode) filtered = filtered.filter((j) => j.syncMode === params.syncMode);
  if (params.sourceDatasourceId) filtered = filtered.filter((j) => j.sourceDatasourceId === params.sourceDatasourceId);
  if (params.targetDatasourceId) filtered = filtered.filter((j) => j.targetDatasourceId === params.targetDatasourceId);

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSize);

  return { items, total, page, pageSize };
}

export async function getJobById(id: string): Promise<IntegrationJob | null> {
  const db = getDb();
  const result = await db.select().from(integrationJobs).where(eq(integrationJobs.id, id)).limit(1);
  return result[0] || null;
}

export async function getJobByCode(code: string): Promise<IntegrationJob | null> {
  const db = getDb();
  const result = await db.select().from(integrationJobs).where(eq(integrationJobs.code, code)).limit(1);
  return result[0] || null;
}

export async function createJob(input: Omit<NewIntegrationJob, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'status'> & { createdBy: string }) {
  const db = getDb();

  // 检查 code 是否已存在
  const existing = await getJobByCode(input.code);
  if (existing) {
    throw new Error(`任务编码 ${input.code} 已存在`);
  }

  // 验证字段映射
  if (input.fieldMapping && input.fieldMapping.length > 0) {
    const validation = validateMappings(input.fieldMapping);
    if (!validation.valid) {
      throw new Error(`字段映射验证失败: ${validation.errors.join('; ')}`);
    }
  }

  const job: NewIntegrationJob = {
    id: generateId('job'),
    name: input.name,
    code: input.code,
    description: input.description,
    sourceDatasourceId: input.sourceDatasourceId,
    targetDatasourceId: input.targetDatasourceId,
    sourceConfig: input.sourceConfig || {},
    targetConfig: input.targetConfig || {},
    fieldMapping: input.fieldMapping || [],
    filterCondition: input.filterCondition,
    syncMode: input.syncMode || 'full',
    watermarkField: input.watermarkField,
    watermarkValue: input.watermarkValue,
    scheduleType: input.scheduleType || 'manual',
    scheduleCron: input.scheduleCron,
    batchSize: input.batchSize ?? 1000,
    concurrency: input.concurrency ?? 1,
    retryCount: input.retryCount ?? 3,
    retryInterval: input.retryInterval ?? 60,
    status: 'stopped',
    version: 1,
    createdBy: input.createdBy,
  };

  await db.insert(integrationJobs).values(job);
  return getJobById(job.id);
}

export async function updateJob(id: string, input: Partial<{
  name: string;
  description: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceConfig: Record<string, unknown>;
  targetConfig: Record<string, unknown>;
  fieldMapping: any[];
  filterCondition: string;
  syncMode: string;
  watermarkField: string;
  watermarkValue: string;
  scheduleType: string;
  scheduleCron: string;
  batchSize: number;
  concurrency: number;
  retryCount: number;
  retryInterval: number;
  status: string;
}>) {
  const db = getDb();
  const existing = await getJobById(id);
  if (!existing) throw new Error('任务不存在');

  // 如果更新了字段映射，验证一下
  if (input.fieldMapping) {
    const validation = validateMappings(input.fieldMapping);
    if (!validation.valid) {
      throw new Error(`字段映射验证失败: ${validation.errors.join('; ')}`);
    }
  }

  const updateData: Record<string, unknown> = { ...input, updatedAt: new Date(), version: existing.version + 1 };
  await db.update(integrationJobs).set(updateData).where(eq(integrationJobs.id, id));
  return getJobById(id);
}

export async function deleteJob(id: string) {
  const db = getDb();
  await db.delete(integrationJobs).where(eq(integrationJobs.id, id));
}

// ============================================================
// 任务启停控制
// ============================================================
export async function startJob(id: string): Promise<IntegrationJob | null> {
  const db = getDb();
  const job = await getJobById(id);
  if (!job) return null;
  if (job.scheduleType === 'manual') {
    throw new Error('手动触发的任务无需启动调度');
  }
  await db.update(integrationJobs).set({ status: 'running', updatedAt: new Date() }).where(eq(integrationJobs.id, id));
  return getJobById(id);
}

export async function stopJob(id: string): Promise<IntegrationJob | null> {
  const db = getDb();
  const job = await getJobById(id);
  if (!job) return null;
  await db.update(integrationJobs).set({ status: 'stopped', updatedAt: new Date() }).where(eq(integrationJobs.id, id));
  return getJobById(id);
}

export async function pauseJob(id: string): Promise<IntegrationJob | null> {
  const db = getDb();
  const job = await getJobById(id);
  if (!job) return null;
  await db.update(integrationJobs).set({ status: 'paused', updatedAt: new Date() }).where(eq(integrationJobs.id, id));
  return getJobById(id);
}

// ============================================================
// 水位线更新
// ============================================================
export async function updateWatermark(id: string, value: string) {
  const db = getDb();
  await db.update(integrationJobs).set({ watermarkValue: value, updatedAt: new Date() }).where(eq(integrationJobs.id, id));
}

// ============================================================
// 获取需要调度的任务（定时任务扫描用）
// ============================================================
export async function listScheduledJobs(): Promise<IntegrationJob[]> {
  const db = getDb();
  const all = await db.select().from(integrationJobs);
  return all.filter((j) => j.status === 'running' && j.scheduleType === 'cron' && j.scheduleCron);
}
