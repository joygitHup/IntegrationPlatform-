import { NextRequest } from 'next/server';
import { proxyToDjango } from '@/server/utils/django-fallback';

async function handle(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxyToDjango(request, `/${(path || []).join('/')}`);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
