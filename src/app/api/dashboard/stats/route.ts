import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { getDashboardStats } from '@/server/services/monitor-service';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'execution:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const stats = await getDashboardStats();
  return NextResponse.json(stats);
}
