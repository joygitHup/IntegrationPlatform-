import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import {
  listApplications,
  createApplication,
} from '@/server/services/app-service';
import { recordAuditLog } from '@/server/services/audit-service';
import { z } from 'zod';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  description: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().default('business'),
  loginType: z.enum(['jwt', 'ticket', 'oauth2', 'saml', 'form_based']),
  loginUrl: z.string().optional(),
  logoutUrl: z.string().optional(),
  callbackUrl: z.string().optional(),
  sortOrder: z.number().optional(),
  visible: z.boolean().optional(),
  settings: z.record(z.string(), z.any()).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
  const keyword = url.searchParams.get('keyword') || undefined;
  const category = url.searchParams.get('category') || undefined;
  const status = url.searchParams.get('status') || undefined;
  const loginType = url.searchParams.get('loginType') || undefined;
  const visibleOnly = url.searchParams.get('visibleOnly') === 'true';

  const result = await listApplications({ page, pageSize, keyword, category, status, loginType, visibleOnly });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!hasPermission(auth, 'application:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const body = await request.json();
  const data = createSchema.parse(body);

  const app = await createApplication({
    ...data,
    createdBy: auth.userId,
  });

  if (!app) {
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'CREATE',
    resourceType: 'APP',
    resourceId: app.id,
    resourceName: app.name,
    detail: { code: app.code, loginType: app.loginType },
    ip: request.headers.get('x-forwarded-for') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return NextResponse.json(app);
}
