import { NextResponse, NextRequest } from 'next/server';
import { generateSamlMetadata } from '@/server/services/sso-engine';
import { getApplication } from '@/server/services/app-service';

// GET /api/sso/saml/metadata/[appId] - SAML IdP 元数据
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;

  try {
    const app = await getApplication(appId);
    if (!app) {
      return NextResponse.json({ error: '应用不存在' }, { status: 404 });
    }

    const baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT
      ? `https://${process.env.COZE_PROJECT_DOMAIN_DEFAULT}`
      : `${'https://'}`;

    const xml = generateSamlMetadata(appId, app.name, baseUrl);
    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/samlmetadata+xml; charset=utf-8',
        'Content-Disposition': `inline; filename="idp-metadata-${appId}.xml"`,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '生成元数据失败';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
