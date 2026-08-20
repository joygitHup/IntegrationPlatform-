/**
 * 获取可用连接器列表（带配置表单 Schema）
 */
import { NextResponse } from 'next/server';
import { listConnectors, listConnectorsByCategory } from '@/server/connectors/registry';
import { authenticate } from '@/server/utils/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticate(request as any);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const capability = searchParams.get('capability') as 'read' | 'write' | null;

  let connectors = category ? listConnectorsByCategory(category) : listConnectors();

  if (capability === 'read') {
    connectors = connectors.filter(c => c.typeSupport === 'source' || c.typeSupport === 'both');
  } else if (capability === 'write') {
    connectors = connectors.filter(c => c.typeSupport === 'target' || c.typeSupport === 'both');
  }

  return NextResponse.json({
    total: connectors.length,
    items: connectors.map(c => ({
      type: c.type,
      displayName: c.displayName,
      category: c.category,
      icon: c.icon,
      description: c.description,
      capabilities: c.capabilities,
      authMethods: c.authMethods,
      configSchema: c.configSchema,
    })),
  });
}
