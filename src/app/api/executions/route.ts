import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { listExecutions, getExecutionDetail } from '@/server/services/monitor-service';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'execution:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const jobId = searchParams.get('jobId') || undefined;
  const status = searchParams.get('status') || undefined;
  const triggerType = searchParams.get('triggerType') || undefined;
  const startTime = searchParams.get('startTime') ? parseInt(searchParams.get('startTime')!, 10) : undefined;
  const endTime = searchParams.get('endTime') ? parseInt(searchParams.get('endTime')!, 10) : undefined;

  const result = await listExecutions({ page, pageSize, jobId, status, triggerType, startTime, endTime });
  return NextResponse.json(result);
}
