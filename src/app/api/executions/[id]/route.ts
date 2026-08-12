import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { getExecutionDetail } from '@/server/services/monitor-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'execution:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const execution = await getExecutionDetail(id);
  if (!execution) {
    return NextResponse.json({ error: '执行记录不存在' }, { status: 404 });
  }
  return NextResponse.json(execution);
}
