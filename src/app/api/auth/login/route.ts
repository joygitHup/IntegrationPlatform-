import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserByUsername, updateLastLogin } from '@/server/services/user-service';
import { verifyPassword } from '@/server/utils/password';
import { signAccessToken, signRefreshToken } from '@/server/utils/jwt';
import { recordAuditLog } from '@/server/services/audit-service';
import { seedDefaultData } from '@/server/services/user-service';
import { checkLoginRateLimit } from '@/server/utils/rate-limit';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  try {
    // 登录限流
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateResult = await checkLoginRateLimit(clientIp);
    if (!rateResult.success) {
      return NextResponse.json(
        { error: '请求过于频繁，请稍后再试' },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil(rateResult.msBeforeNext / 1000).toString(),
          },
        },
      );
    }

    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数错误', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // 确保初始数据存在
    await seedDefaultData();

    const { username, password } = parsed.data;
    const user = await getUserByUsername(username);

    if (!user) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    if (user.status !== 'active') {
      return NextResponse.json({ error: '账号已被禁用' }, { status: 403 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    const userAgent = request.headers.get('user-agent') || '';
    if (!valid) {
      // 记录失败登录
      await recordAuditLog({
        userId: user.id,
        username: user.username,
        action: 'LOGIN',
        detail: { success: false, reason: 'wrong_password' },
        ip: clientIp,
        userAgent,
      });
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    // 更新最后登录时间
    await updateLastLogin(user.id);

    // 生成 token
    const accessToken = signAccessToken({
      userId: user.id,
      username: user.username,
      roleId: user.roleId || '',
    });
    const refreshToken = signRefreshToken({
      userId: user.id,
      username: user.username,
      roleId: user.roleId || '',
    });

    // 记录审计日志
    await recordAuditLog({
      userId: user.id,
      username: user.username,
      action: 'LOGIN',
      detail: { success: true },
      ip: clientIp,
      userAgent,
    });

    return NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        roleId: user.roleId,
      },
    });
  } catch (error) {
    console.error('[Login] error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
