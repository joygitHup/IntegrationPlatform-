import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { startJob, stopJob, pauseJob, getJobById } from '@/server/services/job-service';
import { recordAuditLog } from '@/server/services/audit-service';
import { startWorker } from '@/server/queue/worker';

/**
 * 控制任务调度状态（启动/停止/暂停）
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'job:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { jobId, action } = body as { jobId: string; action: 'start' | 'stop' | 'pause' };

    if (!jobId || !action) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const job = await getJobById(jobId);
    if (!job) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    let resultJob;
    switch (action) {
      case 'start':
        resultJob = await startJob(jobId);
        // 启动调度器
        await startWorker();
        break;
      case 'stop':
        resultJob = await stopJob(jobId);
        break;
      case 'pause':
        resultJob = await pauseJob(jobId);
        break;
      default:
        return NextResponse.json({ error: `不支持的操作: ${action}` }, { status: 400 });
    }

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'UPDATE',
      resourceType: 'JOB',
      resourceId: jobId,
      resourceName: job.name,
      detail: { statusChange: action },
      ip: auth.ip,
      userAgent: auth.userAgent,
      traceId: auth.traceId,
    });

    return NextResponse.json(resultJob);
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
