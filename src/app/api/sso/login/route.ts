import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import {
  initiateSsoLogin,
  generateOAuth2Url,
  recordLoginLog,
} from '@/server/services/sso-engine';
import { z } from 'zod';

const loginSchema = z.object({
  appId: z.string(),
  redirectUrl: z.string().optional(),
});

/**
 * 发起 SSO 登录
 * 根据应用的登录类型生成对应的登录 URL
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = await request.json();
  const data = loginSchema.parse(body);
  const ip = request.headers.get('x-forwarded-for') || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  // 获取应用信息并判断登录类型
  const result = await initiateSsoLogin(data.appId, {
    id: auth.userId,
    username: auth.username,
    email: auth.email,
    displayName: auth.displayName,
    roleId: auth.roleId,
  }, {
    ip,
    userAgent,
    redirectPath: data.redirectUrl,
  });

  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  // 直接 302 跳转模式：GET /api/sso/login?appId=xxx
  const auth = await authenticate(request);
  if (!auth) {
    const loginUrl = `/login?redirect=${encodeURIComponent(request.url)}`;
    return NextResponse.redirect(loginUrl, 302);
  }

  const url = new URL(request.url);
  const appId = url.searchParams.get('appId') || '';
  const redirectUrl = url.searchParams.get('redirect') || undefined;

  if (!appId) return NextResponse.json({ error: '缺少 appId' }, { status: 400 });

  const ip = request.headers.get('x-forwarded-for') || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  const result = await initiateSsoLogin(appId, {
    id: auth.userId,
    username: auth.username,
    email: auth.email,
    displayName: auth.displayName,
    roleId: auth.roleId,
  }, {
    ip,
    userAgent,
    redirectPath: redirectUrl,
  });

  // 如果生成了 URL，则重定向
  const targetUrl = (result as any).url || (result as any).loginUrl;
  if (targetUrl) {
    return NextResponse.redirect(targetUrl, 302);
  }

  return NextResponse.json(result);
}
