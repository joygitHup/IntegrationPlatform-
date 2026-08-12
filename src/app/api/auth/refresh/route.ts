import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyToken, signAccessToken, signRefreshToken } from '@/server/utils/jwt';

const refreshSchema = z.object({
  refreshToken: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    const payload = verifyToken(parsed.data.refreshToken);
    if (!payload || payload.type !== 'refresh') {
      return NextResponse.json({ error: '无效的 refresh token' }, { status: 401 });
    }

    const accessToken = signAccessToken({
      userId: payload.userId,
      username: payload.username,
      roleId: payload.roleId,
    });
    const newRefreshToken = signRefreshToken({
      userId: payload.userId,
      username: payload.username,
      roleId: payload.roleId,
    });

    return NextResponse.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error('[RefreshToken] error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
