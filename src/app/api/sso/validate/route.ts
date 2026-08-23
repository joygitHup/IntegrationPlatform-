import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  validateTicket,
  validateSsoToken,
  recordLoginLog,
} from '@/server/services/sso-engine';

const validateSchema = z.object({
  ticket: z.string().optional(),
  token: z.string().optional(),
  appId: z.string().optional(),
});

/**
 * 验证 SSO 登录凭证（由目标系统调用）
 * 支持 ticket 验证和 token 验证两种模式
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const data = validateSchema.parse(body);
  const ip = request.headers.get('x-forwarded-for') || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  try {
    let result;

    if (data.ticket) {
      // 一次性 Ticket 验证
      result = await validateTicket(data.ticket, {
        ip,
        userAgent,
        appId: data.appId,
      });
    } else if (data.token) {
      // JWT Token 验证
      result = await validateSsoToken(data.token);
    } else {
      return NextResponse.json(
        { valid: false, error: '缺少 ticket 或 token' },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { valid: false, error: error.message || '验证失败' },
      { status: 401 }
    );
  }
}

/**
 * GET 方式验证（方便浏览器直接测试）
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get('ticket') || '';
  const token = url.searchParams.get('token') || '';
  const appId = url.searchParams.get('appId') || '';
  const ip = request.headers.get('x-forwarded-for') || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;

  try {
    let result;
    if (ticket) {
      result = await validateTicket(ticket, { ip, userAgent, appId: appId || undefined });
    } else if (token) {
      result = await validateSsoToken(token);
    } else {
      return NextResponse.json(
        { valid: false, error: '缺少 ticket 或 token' },
        { status: 400 }
      );
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { valid: false, error: error.message || '验证失败' },
      { status: 401 }
    );
  }
}
