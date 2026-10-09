# 集成中台 Python SDK

集成中台（Integration Platform）官方 Python SDK，覆盖开放 API、SSO 5 种类型接入、跳板模式。

## 安装

```bash
pip install -e sdk/python
```

依赖：`PyJWT>=2.9`、`cryptography>=43.0`、`lxml>=5.3`（SAML 验签）。

## 模块结构

```
integration_hub/
├── client.py            # 开放 API 客户端（X-Api-Key 鉴权）
├── launcher.py          # A 系统 Launcher（让 A 用户免登跳 B）
└── sso/
    ├── __init__.py      # SSO 统一入口：configure / get_config
    ├── jwks.py          # JWKS 公钥缓存（PyJWKClient 单例）
    ├── jwt_mode.py      # JWT 类型：RS256/HS256 验签 + 中台 validate 回调
    ├── ticket_mode.py   # Ticket 类型：一次性票据消费
    ├── oauth2_mode.py   # OAuth2 类型：授权码 + PKCE + userinfo
    ├── saml_mode.py     # SAML 类型：SP metadata + 断言解析
    ├── form_mode.py     # Form-Based 类型：账号绑定 + 中台代填
    └── middleware.py    # Django/Flask/FastAPI 统一落地中间件
```

## 一、开放 API 接入（数据集成场景）

```python
from integration_hub import IntegrationHub

hub = IntegrationHub(api_key="ipk_...", base_url="http://127.0.0.1:8000/api")
print(hub.catalog())
print(hub.me())
hub.trigger_job("job_xxx")
```

自助开户（无需预先生成 API Key）：

```python
from integration_hub import IntegrationHub

data = IntegrationHub.register(name="我的公司", code="partner_demo")
hub = IntegrationHub(api_key=data["apiKey"])
print(hub.me())
print(hub.datasources())  # 含控制台指派给该 Key 的数据源
```

## 二、SSO 接入：5 种类型全覆盖

### 2.1 全局配置

```python
from integration_hub.sso import configure
configure(
    platform_url="http://127.0.0.1:8000",
    audience="app_bbb",       # B 应用在中台的 code（RS256 aud 校验）
    app_id="app_bbb",         # B 应用在中台的 id（HS256 / ticket 回调用）
    app_secret="",            # 可选：HS256 模式本地验签，避免调中台 validate
    auto_create_user=True,    # 用户不存在时自动建本地账号
    default_redirect="/dashboard",
)
```

### 2.2 JWT 类型（B 系统接入 5 行）

中台管理后台勾选 B 应用 `settings.useRsa=true`，B 系统 SDK 自动拉 JWKS 公钥本地验签，**零密钥保管、零回调中台**。

```python
# B 系统 Django settings.py
MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]
# 自动处理 /sso/callback?token=xxx
```

```python
# Flask
from integration_hub.sso.middleware import flask_callback
app = flask_callback(app)
```

```python
# FastAPI
from integration_hub.sso.middleware import fastapi_callback
app.include_router(fastapi_callback())
```

### 2.3 Ticket 类型（B 系统接入 5 行）

SDK 中间件自动识别 `?ticket=xxx` 并消费。

```python
MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]
# 自动处理 /sso/callback?ticket=xxx
```

### 2.4 OAuth2 类型（A 系统作为客户端接入中台 IdP）

```python
from integration_hub.sso import OAuth2Client

oauth = OAuth2Client(
    client_id="appa",
    client_secret="<appa 在中台的 secret>",
    redirect_uri="http://A域名/oauth/callback",
)

# 1) 登录入口：生成跳转 URL + PKCE
url, verifier, state = oauth.create_authorization_url(state="random-state")
return redirect(url)

# 2) callback 路由：用 code 换 access_token + userinfo
tokens = oauth.exchange(code, code_verifier=verifier)
# tokens = {access_token, refresh_token, expires_in, user_info}
```

### 2.5 SAML 类型（A 系统作为 SP 接入中台 IdP）

```python
from integration_hub.sso import SamlSP

sp = SamlSP(
    app_id="appa",
    sp_entity_id="http://A域名/sp",
    acs_url="http://A域名/saml/acs",
    idp_cert_pem="<中台 IdP 的 SAML 证书>",
)

# 1) 生成 SP metadata，提交到中台应用管理 → SAML 应用
print(sp.metadata())

# 2) 登录入口：跳到中台 IdP
return redirect(sp.login_url(relay_state="/dashboard"))

# 3) ACS 路由：解析断言（强制验 XML-DSig）
user = sp.parse(request.POST["SAMLResponse"])
```

### 2.6 Form-Based 类型（A 系统绑定 B 账号密码，中台代填）

```python
from integration_hub.sso import FormBasedLauncher

fb = FormBasedLauncher(api_key="ipk_xxx", app_id="app_b")

# 1) 用户在 A 这边登记 B 系统的账号密码（中台 AES 加密存储）
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

### 2.7 自定义本地用户映射

中间件默认不做本地映射（直接把 SSO user_info 写入 session）。重写 `_map_or_create_user` 实现本地建号：

```python
from integration_hub.sso import middleware

def _map_or_create_user(user_info):
    from myapp.models import User
    user, created = User.objects.get_or_create(
        username=user_info["username"],
        defaults={"email": user_info.get("email", "")},
    )
    return user

middleware._map_or_create_user = _map_or_create_user
```

## 三、A 系统 Launcher：跳板模式

A 用户已在中台登录 → A 后端拿中台 JWT → 调中台 `/api/sso/redirect` → 中台 302 到 B。

```python
from integration_hub.launcher import Launcher

launcher = Launcher(
    platform_url="http://127.0.0.1:8000",
    access_token=request.session["zhongtai_access_token"],
)
return redirect(launcher.redirect_url(target="appb", redirect="/dashboard"))
```

兼容老应用（A 自签 launch token）：

```python
launcher = Launcher(
    platform_url="http://127.0.0.1:8000",
    source_app="appa",
    source_secret="<A 在中台的 secretKey>",
    user_id=request.user.id,
    username=request.user.username,
)
return redirect(launcher.launch_via_token(target="appb", redirect="/dashboard"))
```

## 四、对接成本对照

| SSO 类型 | A 接入 | B 接入 |
|---|---|---|
| jwt | 3 行（Launcher Bearer） | 5 行（中间件） |
| ticket | 3 行 | 5 行（中间件） |
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
