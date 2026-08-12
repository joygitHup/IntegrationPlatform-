import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { listUsers, createUser } from '@/server/services/user-service';
import { recordAuditLog } from '@/server/services/audit-service';
import { z } from 'zod';

const createUserSchema = z.object({
  username: z.string().min(3).max(64),
  email: z.string().email().optional().or(z.literal('')),
  displayName: z.string().max(64).optional(),
  password: z.string().min(6).max(128),
  roleId: z.string().min(1).max(32),
});

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'user:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const keyword = searchParams.get('keyword') || undefined;
  const roleId = searchParams.get('roleId') || undefined;
  const status = searchParams.get('status') || undefined;

  const result = await listUsers({ page, pageSize, keyword, roleId, status });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'user:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数错误', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const user = await createUser(parsed.data);

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'CREATE',
      resourceType: 'USER',
      resourceId: user.id,
      resourceName: user.username,
      detail: { username: user.username, roleId: user.roleId },
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
