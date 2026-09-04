import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { listFieldAuditLogs, getFieldAuditLog } from '@/server/services/field-audit-service';

// GET /api/field-audit - 字段变更审计列表
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (id) {
    const audit = await getFieldAuditLog(id);
    if (!audit) {
      return NextResponse.json({ error: '记录不存在' }, { status: 404 });
    }
    return NextResponse.json({ data: audit });
  }

  const result = await listFieldAuditLogs({
    jobId: searchParams.get('jobId') || undefined,
    executionId: searchParams.get('executionId') || undefined,
    recordKey: searchParams.get('recordKey') || undefined,
    operation: (searchParams.get('operation') as 'create' | 'update' | 'delete') || undefined,
    page: parseInt(searchParams.get('page') || '1'),
    pageSize: parseInt(searchParams.get('pageSize') || '20'),
  });

  return NextResponse.json(result);
}
