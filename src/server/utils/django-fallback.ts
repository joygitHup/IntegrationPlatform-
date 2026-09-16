import { NextRequest, NextResponse } from 'next/server';

export function djangoApiBase(): string {
  return (
    process.env.DJANGO_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    'http://127.0.0.1:8000/api'
  ).replace(/\/+$/, '');
}

export async function proxyToDjango(request: NextRequest, apiPath: string) {
  const search = new URL(request.url).search;
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const url = `${djangoApiBase()}${path}${search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');
  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  try {
    const resp = await fetch(url, { method, headers, body, redirect: 'manual' });
    const outHeaders = new Headers();
    const contentType = resp.headers.get('content-type');
    if (contentType) outHeaders.set('content-type', contentType);
    return new NextResponse(await resp.arrayBuffer(), { status: resp.status, headers: outHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: `Django 后端不可达: ${(error as Error).message}` },
      { status: 502 },
    );
  }
}
