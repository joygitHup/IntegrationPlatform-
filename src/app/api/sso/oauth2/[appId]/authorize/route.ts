import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { getApplication } from '@/server/services/app-service';
import { initiateSsoLogin } from '@/server/services/sso-engine';

/**
 * GET /api/sso/oauth2/:appId/authorize - 发起 OAuth2 授权跳转
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.redirect('/login');
  }

  const { appId } = await params;
  const app = await getApplication(appId);
  if (!app || app.status !== 'active') {
    return NextResponse.json({ error: '应用不存在或已禁用' }, { status: 404 });
  }

  if (app.loginType !== 'oauth2') {
    return NextResponse.json({ error: '该应用不支持 OAuth2 登录' }, { status: 400 });
  }

  const url = new URL(request.url);
  const redirectUri = url.searchParams.get('redirect_uri') || '';

  const result = await initiateSsoLogin(appId, {
    id: auth.userId,
    username: auth.username,
    email: auth.email,
    displayName: auth.displayName,
    roleId: auth.roleId,
  }, {
    ip: (request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown').split(',')[0].trim(),
    userAgent: request.headers.get('user-agent') || '',
    oauthRedirectUri: redirectUri,
  });

  const targetUrl = (result as any).url || (result as any).authorizeUrl;
  if (targetUrl) {
    return NextResponse.redirect(targetUrl, 302);
  }

  return NextResponse.json(result);
}
