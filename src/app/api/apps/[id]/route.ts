import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import {
  getApplication,
  updateApplication,
  deleteApplication,
  toggleApplicationStatus,
} from '@/server/services/app-service';
import { recordAuditLog } from '@/server/services/audit-service';
import { z } from 'zod';

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  loginType: z.enum(['jwt', 'ticket', 'oauth2', 'saml', 'form_based']).optional(),
  loginUrl: z.string().optional(),
  logoutUrl: z.string().optional(),
  callbackUrl: z.string().optional(),
  sortOrder: z.number().optional(),
  visible: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  settings: z.record(z.string(), z.any()).optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { id } = await params;
  const app = await getApplication(id);
  if (!app) return NextResponse.json({ error: '应用不存在' }, { status: 404 });

  return NextResponse.json(app);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!hasPermission(auth, 'application:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const data = updateSchema.parse(body);

  const updated = await updateApplication(id, data);
  if (!updated) return NextResponse.json({ error: '应用不存在' }, { status: 404 });

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'UPDATE',
    resourceType: 'APP',
    resourceId: id,
    resourceName: updated.name,
    detail: data,
    ip: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!hasPermission(auth, 'application:delete')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { id } = await params;
  const app = await getApplication(id);
  if (!app) return NextResponse.json({ error: '应用不存在' }, { status: 404 });

  const deleted = await deleteApplication(id);

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'DELETE',
    resourceType: 'APP',
    resourceId: id,
    resourceName: app.name,
    detail: { code: app.code },
    ip: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return NextResponse.json({ success: deleted });
}
