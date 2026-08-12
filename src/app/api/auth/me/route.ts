import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: auth.userId,
        username: auth.username,
        roleId: auth.roleId,
        permissions: auth.permissions,
      },
    });
  } catch (error) {
    console.error('[Me] error:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
