import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { getUserById, updateUser, deleteUser } from '@/server/services/user-service';
import { recordAuditLog } from '@/server/services/audit-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'user:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const user = await getUserById(id);
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }
  return NextResponse.json(user);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'user:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const user = await updateUser(id, body);
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'UPDATE',
      resourceType: 'USER',
      resourceId: id,
      resourceName: user.username,
      detail: { fields: Object.keys(body) },
      ip: auth.ip,
      userAgent: auth.userAgent,
      traceId: auth.traceId,
    });

    return NextResponse.json(user);
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
  if (!hasPermission(auth, 'user:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const user = await getUserById(id);
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }

  await deleteUser(id);

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'DELETE',
    resourceType: 'USER',
    resourceId: id,
    resourceName: user.username,
    ip: auth.ip,
    userAgent: auth.userAgent,
    traceId: auth.traceId,
  });

  return NextResponse.json({ success: true });
}
