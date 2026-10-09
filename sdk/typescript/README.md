# 集成中台 TypeScript SDK

集成中台（Integration Platform）官方 TypeScript SDK，覆盖开放 API、SSO 5 种类型接入、跳板模式。

## 安装

```bash
npm install @integration-platform/hub-sdk
# 或在 monorepo 直接引用：sdk/typescript
```

依赖：`jose ^5.9`（RS256 + JWKS）、`jsonwebtoken ^9.0`（A 系统 Launcher Token 模式）。

## 模块结构

```
src/
├── index.ts        # 命名空间导出 + IntegrationHub 类
├── sso.ts          # SSO 统一入口：configure + verifyToken + ssoCallbackHandler
├── launcher.ts     # A 系统 Launcher（Bearer + Token 双模式）
├── oauth2.ts       # OAuth2 客户端（PKCE + userinfo）
├── saml.ts         # SAML SP（Node 端需 xml-crypto）
└── form.ts         # Form-Based（账号绑定 + 中台代填）
```

## 一、开放 API 接入（数据集成场景）

```ts
import { IntegrationHub } from '@integration-platform/hub-sdk';

const hub = new IntegrationHub({
  apiKey: 'ipk_...',
  baseUrl: 'http://127.0.0.1:8000/api',
});
await hub.catalog();
await hub.triggerJob('job_xxx');
```

自助开户：

```ts
const data = await IntegrationHub.register({ name: '我的公司', code: 'partner_demo' });
const hub = new IntegrationHub({ apiKey: data.apiKey });
await hub.me();
await hub.datasources(); // 含控制台指派给该 Key 的数据源
```

## 二、SSO 接入：5 种类型全覆盖

### 2.1 全局配置

```ts
import { configure } from '@integration-platform/hub-sdk/sso';

configure({
  platformUrl: 'http://127.0.0.1:8000',
  audience: 'app_bbb',          // B 应用在中台的 code（RS256 aud 校验）
  appId: 'app_bbb',             // B 应用在中台 id（HS256 / ticket 回调用）
  appSecret: '',                // 可选：HS256 本地验签，避免调中台 validate
  autoCreateUser: true,
  defaultRedirect: '/dashboard',
  onSuccess: async (user, request) => {
    // 由调用方实现本地会话建立（如 set cookie）
  },
});
```

### 2.2 JWT 类型（B 系统接入 5 行，Next.js App Router 示例）

中台管理后台勾选 B 应用 `settings.useRsa=true`，B 系统 SDK 自动拉 JWKS 公钥本地验签，**零密钥保管、零回调中台**。

```ts
// app/sso/callback/route.ts
import { ssoCallbackHandler } from '@integration-platform/hub-sdk/sso';
export const GET = ssoCallbackHandler;
```

### 2.3 Ticket 类型（B 系统接入 5 行）

SDK 中间件 `ssoCallbackHandler` 自动识别 URL 上的 `token` / `ticket` / `code` / `SAMLResponse` 参数。

### 2.4 OAuth2 类型（A 系统作为客户端接入中台 IdP）

```ts
import { OAuth2Client } from '@integration-platform/hub-sdk/oauth2';

const oauth = new OAuth2Client({
  clientId: 'appa',
  clientSecret: '...',
  redirectUri: 'http://A/oauth/callback',
});

// 1) 登录入口
const { url, verifier, state } = oauth.createAuthorizationUrl(crypto.randomUUID());
return Response.redirect(url, 302);

// 2) callback
const tokens = await oauth.exchange(code, verifier);
// tokens = { access_token, refresh_token, expires_in, user_info }
```

### 2.5 SAML 类型（A 系统作为 SP 接入中台 IdP）

```ts
import { SamlSP } from '@integration-platform/hub-sdk/saml';

const sp = new SamlSP({
  appId: 'appa',
  spEntityId: 'http://A/sp',
  acsUrl: 'http://A/saml/acs',
});

// 1) SP metadata 提交到中台应用管理
console.log(sp.metadata());

// 2) 登录入口
return Response.redirect(sp.loginUrl('/dashboard'), 302);

// 3) ACS 路由：浏览器端不解析 XML，由 A 后端用 xml-crypto 处理
```

### 2.6 Form-Based 类型（A 系统绑定 B 账号密码，中台代填）

```ts
import { FormBasedLauncher } from '@integration-platform/hub-sdk/form';

const fb = new FormBasedLauncher({ apiKey: 'ipk_xxx', appId: 'app_b' });

// 1) 用户在 A 这边登记 B 系统的账号密码
await fb.bind('usr_xxx', 'user@B', 'secret');

// 2) 调用 launch 触发中台代填
const result = await fb.launch('usr_xxx', '/dashboard');
if (result.needBinding) {
  // 引导用户先绑定
} else {
  // result.html 或 result.url 直接交给浏览器
}
```

## 三、A 系统 Launcher：跳板模式

A 用户已在中台登录 → A 后端拿中台 JWT → 调中台 `/api/sso/redirect` → 中台 302 到 B。

```ts
import { Launcher } from '@integration-platform/hub-sdk/launcher';

const launcher = new Launcher({
  platformUrl: 'http://127.0.0.1:8000',
  accessToken: session.zhongtaiAccessToken,
});
return Response.redirect(
  await launcher.redirectUrl({ target: 'appb', redirect: '/dashboard' }),
  302,
);
```

兼容老应用（A 自签 launch token）：

```ts
const launcher = new Launcher({
  platformUrl: 'http://127.0.0.1:8000',
  sourceApp: 'appa',
  sourceSecret: '<A 在中台的 secretKey>',
  userId: 'usr_xxx',
  username: 'admin',
});
return Response.redirect(
  await launcher.launchViaToken({ target: 'appb', redirect: '/dashboard' }),
  302,
);
```

## 四、对接成本对照

| SSO 类型 | A 接入 | B 接入 |
|---|---|---|
| jwt | 3 行（Launcher Bearer） | 5 行（route handler） |
| ticket | 3 行 | 5 行（route handler） |
| oauth2 | 15 行（OAuth2Client + 2 路由） | — |
| saml | 20 行（SamlSP + ACS） | — |
| form_based | 10 行（FormBasedLauncher） | 0 行 |

## 五、中台端点参考

| 路径 | 用途 |
|---|---|
| `POST /api/auth/login` | 登录拿中台 JWT |
| `POST /api/sso/login` | 应用门户免登跳转 |
| `POST /api/sso/launch` | 跨系统 launch（A 自签 token） |
| `GET /api/sso/redirect` | 跳板模式（A 用 Bearer 调用） |
| `POST /api/sso/validate` | 验证 SSO token（兼容老应用 + 实时吊销） |
| `GET /api/sso/.well-known/jwks.json` | JWKS 公钥公开 |
| `GET /api/sso/.well-known/openid-configuration` | OIDC 发现文档 |
| `GET /api/oauth/authorize` | OAuth2 授权 |
| `POST /api/oauth/token` | OAuth2 token 交换 |
| `GET /api/oauth/userinfo` | OAuth2 userinfo |
| `GET /api/sso/saml/metadata/<appId>` | SAML IdP metadata |
| `GET /api/sso/saml/acs/<appId>` | SAML ACS |

完整规范：`GET /api/open/openapi.json`、`/api/open/docs`。
