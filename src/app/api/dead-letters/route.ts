import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import {
  listDeadLetters,
  reprocessDeadLetter,
  ignoreDeadLetter,
} from '@/server/services/monitor-service';
import { recordAuditLog } from '@/server/services/audit-service';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'dlq:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const jobId = searchParams.get('jobId') || undefined;
  const executionId = searchParams.get('executionId') || undefined;
  const status = searchParams.get('status') || undefined;
  const errorType = searchParams.get('errorType') || undefined;

  const result = await listDeadLetters({ page, pageSize, jobId, executionId, status, errorType });
  return NextResponse.json(result);
}

/**
 * 批量操作：重新处理 / 忽略
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'dlq:reprocess')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { ids, action } = body as { ids: string[]; action: 'reprocess' | 'ignore' };

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '缺少 ids 参数' }, { status: 400 });
    }

    const results = [];
    for (const id of ids) {
      try {
        if (action === 'reprocess') {
          await reprocessDeadLetter(id, auth.userId);
        } else {
          await ignoreDeadLetter(id, auth.userId);
        }
        results.push({ id, success: true });
      } catch (error) {
        results.push({ id, success: false, error: (error as Error).message });
      }
    }

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'UPDATE',
      resourceType: 'JOB',
      resourceId: ids.join(','),
      detail: { action, count: ids.length },
      ip: auth.ip,
      userAgent: auth.userAgent,
      traceId: auth.traceId,
    });

    return NextResponse.json({ results, total: ids.length });
  } catch (error) {
    return NextResponse.json(
      { error: `操作失败: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
