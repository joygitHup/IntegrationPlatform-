import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import {
  getDatasourceById,
  updateDatasource,
  deleteDatasource,
} from '@/server/services/datasource-service';
import { recordAuditLog } from '@/server/services/audit-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'datasource:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const ds = await getDatasourceById(id);
  if (!ds) {
    return NextResponse.json({ error: '数据源不存在' }, { status: 404 });
  }
  return NextResponse.json(ds);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'datasource:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const ds = await updateDatasource(id, body);
    if (!ds) {
      return NextResponse.json({ error: '数据源不存在' }, { status: 404 });
    }

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'UPDATE',
      resourceType: 'DATASOURCE',
      resourceId: id,
      resourceName: ds.name,
      detail: { updatedFields: Object.keys(body) },
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'datasource:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const ds = await getDatasourceById(id);
  if (!ds) {
    return NextResponse.json({ error: '数据源不存在' }, { status: 404 });
  }

  await deleteDatasource(id);

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'DELETE',
    resourceType: 'DATASOURCE',
    resourceId: id,
    resourceName: ds.name,
    detail: { type: ds.type },
    ip: auth.ip,
    userAgent: auth.userAgent,
    traceId: auth.traceId,
  });

  return NextResponse.json({ success: true });
}
