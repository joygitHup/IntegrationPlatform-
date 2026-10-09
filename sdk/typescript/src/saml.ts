/**
 * SAML 类型 SSO 接入：A 系统作为 SAML SP 接入中台 IdP。
 *
 *   import { SamlSP } from '@integration-hub/sdk/saml';
 *   const sp = new SamlSP({ appId: 'appa', spEntityId: 'http://A/sp', acsUrl: 'http://A/saml/acs' });
 *   // 登录入口
 *   return Response.redirect(sp.loginUrl('/dashboard'), 302);
 *   // ACS 路由
 *   const user = sp.parse(params.SAMLResponse);
 */

export interface SamlSPOptions {
  appId: string;
  spEntityId: string;
  acsUrl: string;
  idpCertPem?: string;
  platformUrl?: string;
}

export interface SamlUserInfo {
  nameId?: string;
  username?: string;
  email?: string;
  displayName?: string;
  attributes?: Record<string, string>;
}

export class SamlSP {
  private opts: Required<SamlSPOptions>;

  constructor(opts: SamlSPOptions) {
    this.opts = {
      appId: opts.appId,
      spEntityId: opts.spEntityId,
      acsUrl: opts.acsUrl,
      idpCertPem: opts.idpCertPem || '',
      platformUrl: (opts.platformUrl || 'http://127.0.0.1:8000').replace(/\/+$/, ''),
    };
  }

  metadata(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${this.opts.spEntityId}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</NameIDFormat>
    <AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${this.opts.acsUrl}" index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
  }

  loginUrl(relayState: string = ''): string {
    const url = `${this.opts.platformUrl}/api/sso/saml/acs/${this.opts.appId}`;
    return relayState ? `${url}?RelayState=${encodeURIComponent(relayState)}` : url;
  }

  async parse(samlResponseB64: string): Promise<SamlUserInfo | null> {
    // Node.js 端解析 XML+验签需 xml-crypto / samlp 等库，SDK 这里只提供接口骨架。
    // 浏览器端不解析 SAML（由 A 后端处理），SDK 此方法在 Node 环境抛错指引安装依赖。
    if (typeof process !== 'undefined' && process.versions?.node) {
      throw new Error(
        'Node.js 端解析 SAML 断言需要 xml-crypto + samlp。请在中台后端 /api/sso/validate 验签后传 JSON 用户信息给 A 前端。'
      );
    }
    return null;
  }
}
