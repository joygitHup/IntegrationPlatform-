import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { listSessions, revokeSession, revokeAllSessions } from '@/server/services/sso-engine';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
  const userId = url.searchParams.get('userId') || auth.userId;

  // 管理员可查其他人
  if (userId !== auth.userId && !hasPermission(auth, 'sso:manage')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const result = await listSessions(userId, { page, pageSize });
  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId') || '';
  const all = url.searchParams.get('all') === 'true';

  if (all) {
    // 吊销用户所有会话
    const count = await revokeAllSessions(auth.userId);
    return NextResponse.json({ success: true, revokedCount: count });
  }

  if (!sessionId) {
    return NextResponse.json({ error: '缺少 sessionId' }, { status: 400 });
  }

  const result = await revokeSession(sessionId, auth.userId);
  return NextResponse.json({ success: true, revoked: result });
}
