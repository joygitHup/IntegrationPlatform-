import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { z } from 'zod';
import { recordAuditLog } from '@/server/services/audit-service';
import { getUserBindings, createUserBinding, updateUserBindingById, deleteUserBinding } from '@/server/services/app-service';

const createBindingSchema = z.object({
  appId: z.string(),
  userId: z.string().optional(),
  externalUserId: z.string().optional(),
  credentials: z.record(z.string(), z.any()).optional(),
});

const updateCredSchema = z.object({
  credentials: z.record(z.string(), z.any()).optional(),
  externalUserId: z.string().optional(),
});

// GET /api/apps/bindings?appId=xxx&userId=xxx
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') || auth.userId;
  const appId = url.searchParams.get('appId') || undefined;

  // 管理员可查其他人，普通用户只能查自己
  if (userId !== auth.userId && !hasPermission(auth, 'app:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const bindings = await getUserBindings(userId);
  const filtered = appId ? bindings.filter(b => b.appId === appId) : bindings;
  return NextResponse.json({ items: filtered, total: filtered.length });
}

// POST /api/apps/bindings
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = await request.json();
  const data = createBindingSchema.parse(body);
  const targetUserId = data.userId || auth.userId;

  if (targetUserId !== auth.userId && !hasPermission(auth, 'app:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const bindingId = await createUserBinding(targetUserId, data.appId, {
    externalUserId: data.externalUserId,
    credentials: data.credentials || {},
  });

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'CREATE',
    resourceType: 'APP_BINDING',
    resourceId: bindingId,
    resourceName: data.appId,
    detail: { targetUserId, externalUserId: data.externalUserId },
    ip: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return NextResponse.json({ id: bindingId });
}

// PUT /api/apps/bindings?id=xxx
export async function PUT(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(request.url);
  const bindingId = url.searchParams.get('id') || '';
  const body = await request.json();
  const data = updateCredSchema.parse(body);

  if (!hasPermission(auth, 'app:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const binding = await updateUserBindingById(bindingId, {
    credentials: data.credentials,
    externalUserId: data.externalUserId,
  });

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'UPDATE',
    resourceType: 'APP_BINDING',
    resourceId: bindingId,
    detail: {},
    ip: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return NextResponse.json(binding);
}

// DELETE /api/apps/bindings?id=xxx
export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(request.url);
  const bindingId = url.searchParams.get('id') || '';

  if (!hasPermission(auth, 'app:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  await deleteUserBinding(bindingId);

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'DELETE',
    resourceType: 'APP_BINDING',
    resourceId: bindingId,
    detail: {},
    ip: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return NextResponse.json({ success: true });
}
