import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import {
  listDatasources,
  createDatasource,
  testConnection,
} from '@/server/services/datasource-service';
import { recordAuditLog } from '@/server/services/audit-service';
import { z } from 'zod';

const createDsSchema = z.object({
  name: z.string().min(1).max(128),
  code: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, '编码只能包含字母、数字、下划线和中划线'),
  type: z.enum(['mysql', 'postgres', 'http_api', 'rabbitmq', 'kafka', 'redis']),
  config: z.record(z.string(), z.any()),
  description: z.string().max(255).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'datasource:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const keyword = searchParams.get('keyword') || undefined;
  const type = searchParams.get('type') || undefined;
  const status = searchParams.get('status') || undefined;

  const result = await listDatasources({ page, pageSize, keyword, type, status });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'datasource:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createDsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数错误', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const ds = await createDatasource({
      ...parsed.data,
      createdBy: auth.userId,
    });

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'CREATE',
      resourceType: 'DATASOURCE',
      resourceId: ds?.id,
      resourceName: ds?.name,
      detail: { type: ds?.type, code: ds?.code },
      ip: auth.ip,
      userAgent: auth.userAgent,
      traceId: auth.traceId,
    });

    return NextResponse.json(ds);
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
