import { getDb } from '@/server/db';
import { jobExecutions, deadLetterMessages } from '@/server/db/schema/job-execution';
import { integrationJobs } from '@/server/db/schema/integration-job';
import { datasources } from '@/server/db/schema/datasource';
import { eq } from 'drizzle-orm';

// ============================================================
// 执行历史查询
// ============================================================
export async function listExecutions(params: {
  page?: number;
  pageSize?: number;
  jobId?: string;
  status?: string;
  triggerType?: string;
  startTime?: number;
  endTime?: number;
}) {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const all = await db.select().from(jobExecutions).orderBy(jobExecutions.createdAt);
  let filtered = [...all].reverse();

  if (params.jobId) filtered = filtered.filter((e) => e.jobId === params.jobId);
  if (params.status) filtered = filtered.filter((e) => e.status === params.status);
  if (params.triggerType) filtered = filtered.filter((e) => e.triggerType === params.triggerType);
  if (params.startTime) {
    filtered = filtered.filter((e) => (e.createdAt?.getTime() || 0) >= params.startTime!);
  }
  if (params.endTime) {
    filtered = filtered.filter((e) => (e.createdAt?.getTime() || 0) <= params.endTime!);
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSize);

  return { items, total, page, pageSize };
}

export async function getExecutionDetail(id: string) {
  const db = getDb();
  const result = await db.select().from(jobExecutions).where(eq(jobExecutions.id, id)).limit(1);
  return result[0] || null;
}

// ============================================================
// 死信队列
// ============================================================
export async function listDeadLetters(params: {
  page?: number;
  pageSize?: number;
  jobId?: string;
  executionId?: string;
  status?: string;
  errorType?: string;
}) {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const all = await db.select().from(deadLetterMessages).orderBy(deadLetterMessages.createdAt);
  let filtered = [...all].reverse();

  if (params.jobId) filtered = filtered.filter((d) => d.jobId === params.jobId);
  if (params.executionId) filtered = filtered.filter((d) => d.executionId === params.executionId);
  if (params.status) filtered = filtered.filter((d) => d.status === params.status);
  if (params.errorType) filtered = filtered.filter((d) => d.errorType === params.errorType);

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSize);

  return { items, total, page, pageSize };
}

export async function getDeadLetterById(id: string) {
  const db = getDb();
  const result = await db.select().from(deadLetterMessages).where(eq(deadLetterMessages.id, id)).limit(1);
  return result[0] || null;
}

export async function reprocessDeadLetter(id: string, processedBy: string) {
  const db = getDb();
  const dl = await getDeadLetterById(id);
  if (!dl) throw new Error('死信消息不存在');

  await db.update(deadLetterMessages).set({
    status: 'reprocessed',
    processedAt: new Date(),
    processedBy,
    retryCount: dl.retryCount + 1,
  }).where(eq(deadLetterMessages.id, id));

  return getDeadLetterById(id);
}

export async function ignoreDeadLetter(id: string, processedBy: string) {
  const db = getDb();
  const dl = await getDeadLetterById(id);
  if (!dl) throw new Error('死信消息不存在');

  await db.update(deadLetterMessages).set({
    status: 'ignored',
    processedAt: new Date(),
    processedBy,
  }).where(eq(deadLetterMessages.id, id));

  return getDeadLetterById(id);
}

// ============================================================
// 仪表盘统计
// ============================================================
export async function getDashboardStats() {
  const db = getDb();

  const [jobs, dsList, executions, dlqs] = await Promise.all([
    db.select().from(integrationJobs),
    db.select().from(datasources),
    db.select().from(jobExecutions),
    db.select().from(deadLetterMessages),
  ]);

  // 总任务数
  const totalJobs = jobs.length;

  // 运行中的任务
  const runningJobs = jobs.filter((j) => j.status === 'running').length;

  // 今日执行次数
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayExecutions = executions.filter(
    (e) => (e.createdAt?.getTime() || 0) >= today.getTime(),
  );
  const todayExecutionCount = todayExecutions.length;

  // 今日成功率
  const todaySuccess = todayExecutions.filter((e) => e.status === 'success').length;
  const todaySuccessRate = todayExecutionCount > 0
    ? Math.round((todaySuccess / todayExecutionCount) * 100)
    : 100;

  // 死信队列待处理数
  const pendingDlq = dlqs.filter((d) => d.status === 'pending').length;

  // 最近 7 天执行趋势
  const trendData = getLast7DaysTrend(executions);

  // Top 5 耗时任务（最近 24 小时）
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentExecutions = executions
    .filter((e) => (e.createdAt?.getTime() || 0) >= yesterday.getTime() && e.durationMs)
    .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
    .slice(0, 5)
    .map((e) => {
      const job = jobs.find((j) => j.id === e.jobId);
      return {
        executionId: e.id,
        jobId: e.jobId,
        jobName: job?.name || '未知任务',
        durationMs: e.durationMs,
        status: e.status,
        createdAt: e.createdAt,
      };
    });

  // 任务状态分布
  const statusDistribution = {
    running: jobs.filter((j) => j.status === 'running').length,
    stopped: jobs.filter((j) => j.status === 'stopped').length,
    paused: jobs.filter((j) => j.status === 'paused').length,
    error: jobs.filter((j) => j.status === 'error').length,
  };

  return {
    summary: {
      totalJobs,
      runningJobs,
      todayExecutionCount,
      todaySuccessRate,
      pendingDlq,
    },
    trendData,
    topSlowestJobs: recentExecutions,
    statusDistribution,
  };
}

function getLast7DaysTrend(executions: any[]): { date: string; success: number; failed: number; total: number }[] {
  const result: { date: string; success: number; failed: number; total: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayExecutions = executions.filter(
      (e) => (e.createdAt?.getTime() || 0) >= date.getTime() &&
             (e.createdAt?.getTime() || 0) < nextDate.getTime(),
    );

    const success = dayExecutions.filter((e) => e.status === 'success').length;
    const failed = dayExecutions.filter(
      (e) => e.status === 'failed' || e.status === 'partial_failed',
    ).length;

    result.push({
      date: date.toISOString().slice(0, 10),
      success,
      failed,
      total: dayExecutions.length,
    });
  }

  return result;
}
