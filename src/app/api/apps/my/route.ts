import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { getUserApplications } from '@/server/services/app-service';

/**
 * 获取当前用户可访问的应用列表（用于应用门户）
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(request.url);
  const category = url.searchParams.get('category') || undefined;
  const keyword = url.searchParams.get('keyword') || undefined;

  const apps = await getUserApplications(auth.userId, category);
  const filtered = keyword
    ? apps.filter(a => (a.name && (a.name as string).toLowerCase().includes(keyword.toLowerCase())))
    : apps;
  return NextResponse.json({ items: filtered, total: filtered.length });
}
