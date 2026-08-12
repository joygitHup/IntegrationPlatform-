import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { getQueue } from '@/server/queue';
import { createExecution } from '@/server/queue/etl-executor';
import { recordAuditLog } from '@/server/services/audit-service';
import { getJobById, startJob, stopJob, pauseJob } from '@/server/services/job-service';
import { startWorker } from '@/server/queue/worker';

/**
 * 手动触发任务执行
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'job:execute')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    // 确保 worker 已启动
    await startWorker();

    const body = await request.json();
    const { jobId } = body as { jobId: string };

    if (!jobId) {
      return NextResponse.json({ error: '缺少 jobId 参数' }, { status: 400 });
    }

    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    // 创建执行记录
    const executionId = await createExecution({
      jobId,
      triggerType: 'manual',
      triggeredBy: auth.userId,
    });

    // 加入队列
    const queue = await getQueue();
    const queueJobId = await queue.add({
      jobId,
      executionId,
      triggerType: 'manual',
      triggeredBy: auth.userId,
    });

    // 记录审计
    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'EXECUTE',
      resourceType: 'JOB',
      resourceId: jobId,
      resourceName: job.name,
      detail: { executionId, queueJobId, triggerType: 'manual' },
      ip: auth.ip,
      userAgent: auth.userAgent,
      traceId: auth.traceId,
    });

    return NextResponse.json({
      executionId,
      queueJobId,
      status: 'queued',
    });
  } catch (error) {
    return NextResponse.json(
      { error: `触发失败: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
