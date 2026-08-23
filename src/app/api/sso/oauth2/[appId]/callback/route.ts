import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { handleOAuth2Callback } from '@/server/services/sso-engine';
import { getApplication as getApp } from '@/server/services/app-service';

/**
 * GET /api/sso/oauth2/[appId]/callback - OAuth2 授权回调
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    const errorDesc = searchParams.get('error_description') || error;
    return NextResponse.redirect(`/apps?oauth_error=${encodeURIComponent(errorDesc)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect('/apps?oauth_error=参数缺失');
  }

  const app = await getApp(appId);
  if (!app) {
    return NextResponse.redirect('/apps?oauth_error=应用不存在');
  }

  try {
    const result = await handleOAuth2Callback({
      app,
      code,
      state,
      ip: (request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown').split(',')[0].trim(),
      userAgent: request.headers.get('user-agent') || '',
    });

    // 自动跳转目标系统
    if (result.targetUrl) {
      return NextResponse.redirect(result.targetUrl);
    }

    return NextResponse.redirect('/apps?oauth_success=1');
  } catch (err: any) {
    return NextResponse.redirect(`/apps?oauth_error=${encodeURIComponent(err.message || '授权失败')}`);
  }
}
