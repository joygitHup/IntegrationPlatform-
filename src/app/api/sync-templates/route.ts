import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { listUserSyncTemplates, getUserSyncTemplate, applyUserSyncTemplate } from '@/server/services/user-sync-template-service';

// GET /api/sync-templates - 用户同步模板列表
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get('id');
  const category = searchParams.get('category') || undefined;

  if (templateId) {
    const tpl = getUserSyncTemplate(templateId);
    if (!tpl) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }
    return NextResponse.json({ data: tpl });
  }

  const templates = listUserSyncTemplates(category);
  return NextResponse.json({ items: templates, total: templates.length });
}

// POST /api/sync-templates/apply - 应用模板生成任务配置
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json();
  const result = applyUserSyncTemplate(body.templateId, {
    fieldMappings: body.fieldMappings,
    matchKeys: body.matchKeys,
    sensitiveFields: body.sensitiveFields,
  });

  return NextResponse.json({ data: result });
}
