import { NextResponse, NextRequest } from 'next/server';
import { validateSamlResponse, createSsoSession } from '@/server/services/sso-engine';
import { recordSsoAudit } from '@/server/services/app-service';
import { generateId } from '@/server/utils/id';

// POST /api/sso/saml/acs/[appId] - SAML Assertion Consumer Service
// 接收 IdP 返回的 SAML Response，验证后创建本地会话并跳转到目标应用
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  try {
    const formData = await request.formData();
    const samlResponse = formData.get('SAMLResponse') as string;
    const relayState = formData.get('RelayState') as string || '';

    if (!samlResponse) {
      return NextResponse.json({ error: '缺少 SAMLResponse 参数' }, { status: 400 });
    }

    // 验证并解析 SAML Response
    const userInfo = await validateSamlResponse(appId, samlResponse);

    if (!userInfo.valid) {
      await recordSsoAudit({
        appId,
        userId: '',
        username: userInfo.username,
        eventType: 'login',
        loginType: 'saml',
        result: 'failed',
        failureReason: userInfo.error,
        ip: clientIp,
        userAgent,
      });
      return NextResponse.redirect(`/login?error=${encodeURIComponent(userInfo.error || 'SAML 验证失败')}`);
    }

    const sessionId = generateId('sso-sess');

    // 创建 SSO 会话
    await createSsoSession({
      appId,
      userId: userInfo.username!,
      username: userInfo.username,
      sessionId,
      loginType: 'saml',
      ip: clientIp,
      userAgent,
    });

    // 记录审计日志
    await recordSsoAudit({
      appId,
      userId: userInfo.username!,
      username: userInfo.username,
      eventType: 'login',
      loginType: 'saml',
      result: 'success',
      ip: clientIp,
      userAgent,
      sessionId,
      detail: {
        nameId: userInfo.nameId,
        email: userInfo.email,
        displayName: userInfo.displayName,
        attributes: userInfo.attributes,
      },
    });

    // 跳转到目标页面（RelayState 或 默认页面）
    const redirectUrl = relayState || '/apps';
    return NextResponse.redirect(redirectUrl);

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'SAML 验证失败';
    // 失败跳转到登录页，带上错误信息
    await recordSsoAudit({
      appId,
      userId: '',
      eventType: 'login',
      loginType: 'saml',
      result: 'failed',
      failureReason: msg,
      ip: clientIp,
      userAgent,
    });
    return NextResponse.redirect(`/login?error=${encodeURIComponent(msg)}`);
  }
}

// 部分 IdP 可能使用 GET 方式
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;
  const searchParams = request.nextUrl.searchParams;
  const samlResponse = searchParams.get('SAMLResponse') || '';

  if (!samlResponse) {
    return NextResponse.json({ error: '缺少 SAMLResponse 参数' }, { status: 400 });
  }

  try {
    const userInfo = await validateSamlResponse(appId, samlResponse);

    if (!userInfo.valid) {
      await recordSsoAudit({
        appId,
        userId: '',
        username: userInfo.username,
        eventType: 'login',
        loginType: 'saml',
        result: 'failed',
        failureReason: userInfo.error,
        ip: clientIp,
        userAgent,
      });
      return NextResponse.redirect(`/login?error=${encodeURIComponent(userInfo.error || 'SAML 验证失败')}`);
    }

    const sessionId = generateId('sso-sess');
    await createSsoSession({
      appId,
      userId: userInfo.username!,
      username: userInfo.username,
      sessionId,
      loginType: 'saml',
      ip: clientIp,
      userAgent,
    });

    await recordSsoAudit({
      appId,
      userId: userInfo.username!,
      username: userInfo.username,
      eventType: 'login',
      loginType: 'saml',
      result: 'success',
      ip: clientIp,
      userAgent,
      sessionId,
      detail: {
        nameId: userInfo.nameId,
        email: userInfo.email,
        displayName: userInfo.displayName,
        attributes: userInfo.attributes,
      },
    });

    return NextResponse.redirect(searchParams.get('RelayState') || '/apps');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'SAML 验证失败';
    await recordSsoAudit({
      appId,
      userId: '',
      eventType: 'login',
      loginType: 'saml',
      result: 'failed',
      failureReason: msg,
      ip: clientIp,
      userAgent,
    });
    return NextResponse.redirect(`/login?error=${encodeURIComponent(msg)}`);
  }
}
