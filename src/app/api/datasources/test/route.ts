import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { testConnection, getDatasourceById } from '@/server/services/datasource-service';
import { decrypt } from '@/server/utils/encryption';
import { z } from 'zod';

const testSchema = z.object({
  type: z.string(),
  config: z.record(z.string(), z.any()),
});

/**
 * 测试数据源连接
 * 支持两种模式：
 * 1. body 中直接传 type + config（新建时测试）
 * 2. URL 中传 id（已有数据源测试）
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'datasource:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    let type: string;
    let config: Record<string, unknown>;

    if (id) {
      // 测试已有数据源
      const ds = await getDatasourceById(id, true);
      if (!ds) {
        return NextResponse.json({ error: '数据源不存在' }, { status: 404 });
      }
      type = ds.type;
      config = ds.config as Record<string, unknown>;
    } else {
      // 测试新配置
      const body = await request.json();
      const parsed = testSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: '参数错误', details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      type = parsed.data.type;
      config = parsed.data.config;
    }

    const result = await testConnection({ type, config });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: `测试异常: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
