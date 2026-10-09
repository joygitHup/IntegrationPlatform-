# 跨系统免登对接教程

> A 平台用户 → 集成中台换票 → B 平台免登进入

## 架构

```
A平台(已登录用户)          集成中台(:8000)            B平台(目标系统)
    |                         |                          |
    | 1.用户点击"进入B系统"    |                          |
    | 2.A用自己的secret_key    |                          |
    |   签发短时JWT(含用户身份) |                          |
    | 3.POST /api/sso/launch   |                          |
    |   {from:A, to:B, token}  |                          |
    |------------------------->|                          |
    |                          | 4.用A的密钥验证token      |
    |                          |   提取用户身份            |
    |                          | 5.按B的登录方式签发免登URL |
    |<----{url: B?token=...}---|                          |
    |                          |                          |
    | 6.window.open(url)       |                          |
    |------------------------------------->|               |
    |                          | 7.B落地页读URL的token      |
    |                          |   POST /api/sso/validate  |
    |                          |<---------------------------|
    |                          |----{valid:true,user}------>|
    |                          | 8.B建本地会话,清URL token   |
    |                          | 9.B渲染页面,用户已登录      |
```

## 前置条件

### 在中台注册两个应用

在中台控制台 **应用管理** 页面创建：

| 应用 | 说明 | 关键配置 |
|------|------|---------|
| A 平台（源） | 用户先登录的系统 | secret_key（A 签发 JWT 用） |
| B 平台（目标） | 要免登进入的系统 | login_type + secret_key/login_url |

> 创建后获得 `appId`（如 `app_xxx`）和 `code`（如 `app_aaa`），后续对接全程使用。

---

## A 平台（源系统）对接

### 职责

用户在 A 已登录 → A 签发携带身份的 JWT → 调中台 `/api/sso/launch` → 拿到 B 的免登 URL → 跳转。

### 步骤 1：A 平台签发 JWT

A 平台用**自己在中台注册时的 secret_key**签发 JWT。payload 要求：

```json
{
  "sub": "用户ID",
  "username": "用户名（必填，中台据此匹配用户）",
  "email": "可选",
  "displayName": "可选",
  "roleId": "可选",
  "iss": "A的appId或code",
  "aud": "B的appId或code",
  "iat": 签发时间,
  "exp": 过期时间（建议30-60秒）
}
```

**签发代码（Python 示例）：**

```python
import jwt
from datetime import datetime, timedelta, timezone

def sign_sso_token(user, source_app_id, source_secret_key, target_app_code):
    """A 平台签发跨系统跳转 token"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "email": user.get("email", ""),
        "displayName": user.get("displayName", user["username"]),
        "iss": source_app_id,        # A 的 appId
        "aud": target_app_code,      # B 的 code（可选，建议填）
        "iat": now,
        "exp": now + timedelta(seconds=60),
    }
    return jwt.encode(payload, source_secret_key, algorithm="HS256")
```

**签发代码（Node.js 示例）：**

```typescript
import jwt from 'jsonwebtoken';

function signSsoToken(user: User, sourceAppId: string, sourceSecretKey: string, targetAppCode: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email || '',
      displayName: user.displayName || user.username,
      iss: sourceAppId,
      aud: targetAppCode,
    },
    sourceSecretKey,
    { algorithm: 'HS256', expiresIn: 60 }
  );
}
```

### 步骤 2：调用中台换取 B 的免登 URL

```python
import requests

def launch_to_b(source_app_id, target_app_id, token, redirect_url=""):
    """A 调中台，换取 B 的免登地址"""
    resp = requests.post(
        "http://127.0.0.1:8000/api/sso/launch",
        json={
            "from": source_app_id,    # A 的 appId 或 code
            "to": target_app_id,      # B 的 appId 或 code
            "token": token,            # 步骤 1 签发的 JWT
            "redirectUrl": redirect_url,  # 可选，落地后的子路径
        },
        timeout=10,
    )
    data = resp.json()
    return data.get("url") or data.get("loginUrl")
```

**Node.js 版：**

```typescript
async function launchToB(sourceAppId: string, targetAppId: string, token: string, redirectUrl = ''): Promise<string> {
  const resp = await fetch('http://127.0.0.1:8000/api/sso/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: sourceAppId, to: targetAppId, token, redirectUrl }),
  });
  const data = await resp.json();
  return data.url || data.loginUrl;
}
```

> 也可用 `GET /api/sso/launch?from=A&to=B&token=...` 直接 302 跳转。

### 步骤 3：跳转到 B

```python
# A 平台后端：直接 302 跳转
from django.shortcuts import redirect
return redirect(b_url)

# 或 A 平台前端：新窗口打开
```

```typescript
// A 平台前端
window.open(bUrl, '_blank');
```

### A 平台完整流程示例

```python
# A 平台：用户点击"进入B系统"按钮的接口
def enter_b_system(request):
    user = request.current_user  # A 平台自己已登录的用户
    token = sign_sso_token(
        user={"id": user.id, "username": user.username, "email": user.email},
        source_app_id="app_aaa",
        source_secret_key="A在中台注册时的secret_key",
        target_app_code="app_bbb",
    )
    b_url = launch_to_b("app_aaa", "app_bbb", token, redirect_url="/dashboard")
    return redirect(b_url)
```

---

## B 平台（目标系统）对接

### 职责

B 落地页收到 URL 中的 token/ticket → 调中台 `/api/sso/validate` 校验 → 建本地会话。

### B 的落地页处理逻辑

```typescript
// B 平台：src/lib/sso-consumer.ts

export async function consumeSsoToken(
  searchParams: URLSearchParams,
  platformUrl: string,
  appId: string,
): Promise<{ valid: boolean; user?: any; error?: string }> {
  const token = searchParams.get('token');
  const ticket = searchParams.get('ticket');

  if (!token && !ticket) {
    return { valid: false, error: 'URL 中无 token/ticket' };
  }

  const body: Record<string, string> = { appId };
  if (token) body.token = token;
  if (ticket) body.ticket = ticket;

  const resp = await fetch(`${platformUrl}/api/sso/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}
```

### B 落地页（Next.js App Router）

```tsx
// B 平台：src/app/dashboard/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { consumeSsoToken } from '@/lib/sso-consumer';

const PLATFORM_URL = process.env.NEXT_PUBLIC_SSO_PLATFORM_URL || 'http://127.0.0.1:8000';
const APP_ID = process.env.NEXT_PUBLIC_SSO_APP_ID || 'app_bbb';

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // 无 token/ticket：检查是否已有本地会话
    if (!params.get('token') && !params.get('ticket')) {
      const local = localStorage.getItem('sso_user');
      if (local) {
        setUser(JSON.parse(local));
      } else {
        router.replace('/login');
        return;
      }
      setLoading(false);
      return;
    }

    (async () => {
      const result = await consumeSsoToken(params, PLATFORM_URL, APP_ID);
      if (result.valid) {
        setUser(result.user);
        // 建本地会话
        localStorage.setItem('sso_user', JSON.stringify(result.user));
        // 推荐：调本系统后端建 HttpOnly Cookie 会话
        // await fetch('/api/auth/sso-session', { method: 'POST', body: JSON.stringify(result.user) });

        // 清除 URL 中的 token/ticket（防泄露）
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        url.searchParams.delete('ticket');
        window.history.replaceState({}, '', url.toString());
      } else {
        setError(result.error || '校验失败');
        setTimeout(() => router.replace('/login'), 2000);
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <div>正在验证登录...</div>;
  if (error) return <div>登录失败：{error}，即将跳转登录页</div>;
  if (!user) return <div>请先登录</div>;

  return (
    <div>
      <h1>仪表盘</h1>
      <p>欢迎，{user.displayName || user.username}</p>
    </div>
  );
}
```

### B 后端建会话（推荐，更安全）

```typescript
// B 平台：src/app/api/auth/sso-session/route.ts
import { NextResponse } from 'next/server';
import { serialize } from 'cookie';

export async function POST(req: Request) {
  const ssoUser = await req.json();

  // 用 B 自己的方式签发本地会话 token
  const sessionToken = yourSignFunction(ssoUser);

  const res = NextResponse.json({ ok: true, user: ssoUser });
  res.headers.set('Set-Cookie', serialize('session', sessionToken, {
    httpOnly: true,
    path: '/',
    maxAge: 8 * 3600,  // 8 小时
    sameSite: 'lax',
  }));
  return res;
}
```

落地页 Hook 中改为调本地端点：

```typescript
if (result.valid) {
  await fetch('/api/auth/sso-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.user),
  });
  setUser(result.user);
  // 清 URL token...
}
```

---

## 中台支持的目标系统登录方式

B 平台在中台的 **login_type** 配置决定免登方式：

| login_type | URL 参数 | B 侧处理 | 适用场景 |
|------------|---------|---------|---------|
| `jwt` | `?token=<JWT>` | B 调 `/api/sso/validate` 验签 | B 有开发能力，能接 token |
| `ticket` | `?ticket=<一次性票据>` | B 调 `/api/sso/validate` 消费票据 | 同上，但防重放更安全 |
| `form_based` | 自动提交 HTML 表单 | B 无需改造，中台代填账号密码 | B 有标准登录表单，无法开发对接 |
| `oauth2` | 标准 OAuth2 授权码流程 | B 实现 OAuth2 回调 | B 是标准 OAuth2 服务商 |
| `saml` | 标准 SAML ACS | B 实现 ACS 端点验签 | B 支持企业 SAML |

### form_based（免开发对接）

如果 B 平台有标准的用户名/密码登录表单但无法开发对接代码：

1. 在中台配置 B 的 `login_url`、`usernameField`、`passwordField`
2. 用户在中台门户点击 B 的应用
3. 中台用用户绑定的账号密码生成自动提交的 HTML 表单
4. B 平台无需任何改造，自动完成登录

---

## 各语言 JWT 签发速查

### Python

```python
import jwt
from datetime import datetime, timedelta, timezone

payload = {
    "sub": "user_001",
    "username": "zhangsan",
    "iss": "app_aaa",       # A 的 appId/code
    "aud": "app_bbb",       # B 的 appId/code
    "iat": datetime.now(timezone.utc),
    "exp": datetime.now(timezone.utc) + timedelta(seconds=60),
}
token = jwt.encode(payload, "A的secret_key", algorithm="HS256")
```

### Node.js

```javascript
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { sub: 'user_001', username: 'zhangsan', iss: 'app_aaa', aud: 'app_bbb' },
  'A的secret_key',
  { algorithm: 'HS256', expiresIn: 60 }
);
```

### Java

```java
// 依赖 io.jsonwebtoken:jjwt
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.security.Key;
import java.util.Date;

Key key = Keys.hmacShaKeyFor("A的secret_key".getBytes());
String token = Jwts.builder()
    .setSubject("user_001")
    .claim("username", "zhangsan")
    .setIssuer("app_aaa")
    .setAudience("app_bbb")
    .setIssuedAt(new Date())
    .setExpiration(new Date(System.currentTimeMillis() + 60000))
    .signWith(key)
    .compact();
```

### Go

```go
// 依赖 github.com/golang-jwt/jwt/v5
import "github.com/golang-jwt/jwt/v5"

claims := jwt.MapClaims{
    "sub":      "user_001",
    "username": "zhangsan",
    "iss":      "app_aaa",
    "aud":      "app_bbb",
    "exp":      time.Now().Add(60 * time.Second).Unix(),
    "iat":      time.Now().Unix(),
}
token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
tokenString, _ := token.SignedString([]byte("A的secret_key"))
```

---

## 安全要点

| 要点 | 说明 |
|------|------|
| token 有效期短 | A 签发的 JWT 建议 30-60 秒过期 |
| URL token 立即清除 | B 落地后 `replaceState` 删掉 URL 中的 token |
| appId 必传 | B 校验时传 appId 限定只在该应用密钥下验签 |
| secret_key 不外泄 | A/B 的 secret_key 只存在各自后端环境变量 |
| HTTPS 生产传输 | 生产环境全链路 HTTPS |
| form_based 绑定 | 账号密码在中台 AES-256 加密存储，用户需先绑定 |

---

## 快速验证（curl）

```bash
# 1. A 签发 token（用 A 的 secret_key）
# 假设 A secret_key = "secret-a"，A code = "app_aaa"，B code = "app_bbb"

# 2. 调中台换 B 免登 URL
curl -X POST http://127.0.0.1:8000/api/sso/launch \
  -H "Content-Type: application/json" \
  -d '{"from":"app_aaa","to":"app_bbb","token":"<A签发的JWT>","redirectUrl":"/dashboard"}'
# 返回: {"url": "http://B地址/dashboard?token=..."}

# 3. B 落地页校验 token
curl -X POST http://127.0.0.1:8000/api/sso/validate \
  -H "Content-Type: application/json" \
  -d '{"token":"<中台签发的B的token>","appId":"app_bbb"}'
# 返回: {"valid": true, "user": {...}, "appId": "app_bbb"}

# 也可用 GET（方便直接在浏览器测试）
curl "http://127.0.0.1:8000/api/sso/validate?token=<token>&appId=app_bbb"
```

---

## 附录 C：5 种 SSO 类型 SDK 全对接示例（P0+P1+P2+P3+P4 全量接入后）

中台 SDK 已提供 5 种 SSO 类型的统一接入，Python 与 TypeScript 双语言对等实现。

### C.1 SDK 安装

**Python**：
```bash
pip install -e sdk/python
# 依赖：PyJWT>=2.9（RS256 + JWKS）、cryptography>=43.0、lxml>=5.3（SAML 验签）
```

**TypeScript**：
```bash
npm install @integration-platform/hub-sdk
# 或在 monorepo 直接引用：sdk/typescript
# 依赖：jose ^5.9、jsonwebtoken ^9.0
```

### C.2 全局配置（B 系统接入准备）

```python
from integration_hub.sso import configure
configure(
    platform_url="http://127.0.0.1:8000",
    audience="app_bbb",        # B 应用在中台的 code（RS256 aud 校验）
    app_id="app_bbb",          # B 应用在中台的 id（HS256 回调 validate 用）
    app_secret="",             # 可选：HS256 模式本地验签，避免调中台 validate
    auto_create_user=True,     # 用户不存在时自动建本地账号
    default_redirect="/dashboard",
)
```

```typescript
import { configure } from '@integration-platform/hub-sdk/sso';
configure({
  platformUrl: 'http://127.0.0.1:8000',
  audience: 'app_bbb',
  appId: 'app_bbb',
  autoCreateUser: true,
  defaultRedirect: '/dashboard',
  onSuccess: async (user, request) => {
    // 由调用方实现本地会话建立（如 set cookie）
  },
});
```

### C.3 JWT 类型（B 系统接入 5 行）

```python
# B 系统 Django 配置
MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]
# 自动处理 /sso/callback?token=xxx
```

```typescript
// B 系统 Next.js App Router：app/sso/callback/route.ts
import { ssoCallbackHandler } from '@integration-platform/hub-sdk/sso';
export const GET = ssoCallbackHandler;
```

中台侧仅需在中台应用管理把 B 应用的 `settings.useRsa=true`，B SDK 自动拉 JWKS 公钥本地验签，零密钥保管、零回调中台。

### C.4 Ticket 类型（B 系统接入 5 行）

SDK 中间件自动识别 `?ticket=xxx`，调用 `consume_ticket` 一次性消费：
```python
MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]
# 自动处理 /sso/callback?ticket=xxx
```

### C.5 OAuth2 类型（A 系统作为客户端接入中台 IdP）

```python
from integration_hub.sso import OAuth2Client
oauth = OAuth2Client(
    client_id="appa",
    client_secret="<appa 在中台的 secret>",
    redirect_uri="http://A域名/oauth/callback",
)
# 1) 登录入口
url, verifier, state = oauth.create_authorization_url(state="random")
return redirect(url)
# 2) callback 路由
tokens = oauth.exchange(code, verifier)
# tokens.access_token + tokens.user_info 可用
```

```typescript
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
```

### C.6 SAML 类型（A 系统作为 SP 接入中台 IdP）

```python
from integration_hub.sso import SamlSP
sp = SamlSP(
    app_id="appa",
    sp_entity_id="http://A域名/sp",
    acs_url="http://A域名/saml/acs",
    idp_cert_pem="<中台 IdP 的 SAML 证书>",
)
# 1) 把 SP metadata 提交给中台应用管理
print(sp.metadata())
# 2) 登录入口
return redirect(sp.login_url(relay_state="/dashboard"))
# 3) ACS 路由解析断言（强制验 XML-DSig）
user = sp.parse(request.POST["SAMLResponse"])
```

```typescript
import { SamlSP } from '@integration-platform/hub-sdk/saml';
const sp = new SamlSP({
  appId: 'appa', spEntityId: 'http://A/sp', acsUrl: 'http://A/saml/acs',
});
// 浏览器端不解析 XML，由 A 后端用 xml-crypto 处理
```

### C.7 Form-Based 类型（A 系统绑定 B 账号密码）

```python
from integration_hub.sso import FormBasedLauncher
fb = FormBasedLauncher(api_key="ipk_xxx", app_id="app_b")
# 1) 用户在中台登记 B 系统账号密码
fb.bind(user_id="usr_xxx", username="user@B", password="secret")
# 2) 调用 launch 触发中台代填
result = fb.launch(user_id="usr_xxx", redirect="/dashboard")
if result.get("needBinding"):
    # 引导用户先绑定
    ...
else:
    # result.html 或 result.url 直接交给浏览器
    ...
```

```typescript
import { FormBasedLauncher } from '@integration-platform/hub-sdk/form';
const fb = new FormBasedLauncher({ apiKey: 'ipk_xxx', appId: 'app_b' });
await fb.bind('usr_xxx', 'user@B', 'secret');
const result = await fb.launch('usr_xxx', '/dashboard');
```

### C.8 跳板模式（A=中台控制台 已登录用户免登跳 B）

```python
# A 是中台控制台用户（已登录）：
from integration_hub.launcher import Launcher
launcher = Launcher(
    platform_url="http://127.0.0.1:8000",
    access_token=request.session["zhongtai_access_token"],
)
return redirect(launcher.redirect_url(target="appb", redirect="/dashboard"))
```

```typescript
import { Launcher } from '@integration-platform/hub-sdk/launcher';
const launcher = new Launcher({
  platformUrl: 'http://127.0.0.1:8000',
  accessToken: session.zhongtaiAccessToken,
});
return Response.redirect(await launcher.redirectUrl({ target: 'appb', redirect: '/dashboard' }), 302);
```

### C.9 老应用兼容（HS256 多应用密钥）

中台 `_jwt_login` 默认走 HS256（用 app.secret_key 签发），`validate_sso_token` 默认回退到多应用密钥匹配。老应用无需任何修改即可继续工作；新应用在中台应用管理里勾选 `settings.useRsa=true` 即可启用 RS256。

### C.10 JWKS 与 OIDC 发现端点

- 公钥公开：`GET /api/sso/.well-known/jwks.json`
- OIDC 元信息：`GET /api/sso/.well-known/openid-configuration`

A/B 系统可用任意标准 OAuth2/OIDC 客户端库（python-social-auth、next-auth、panva/node-oidc-provider 等）直接接入，无需安装本仓库 SDK。

