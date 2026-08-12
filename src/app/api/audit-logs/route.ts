import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { listAuditLogs } from '@/server/services/audit-service';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'audit:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const userId = searchParams.get('userId') || undefined;
  const action = searchParams.get('action') || undefined;
  const resourceType = searchParams.get('resourceType') || undefined;
  const resourceId = searchParams.get('resourceId') || undefined;

  const result = await listAuditLogs({ page, pageSize, userId, action, resourceType, resourceId });
  return NextResponse.json(result);
}
