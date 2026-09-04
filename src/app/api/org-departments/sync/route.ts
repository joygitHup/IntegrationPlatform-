import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { syncOrgFromSource } from '@/server/services/org-sync-service';

// POST /api/org-departments/sync - 从源系统同步组织架构
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json();
  const result = await syncOrgFromSource({
    jobId: body.jobId,
    departments: body.departments || [],
    mode: body.mode || 'incremental',
    operatorId: auth.userId,
  });

  return NextResponse.json(result);
}
