"""
集成中台 Django 配置。

设计要点：
- JSON 使用 camelCase，与前端 api-client.ts 字段对齐（accessToken / pageSize / roleId 等）
- URL 无尾斜杠，与 Next.js /api/* 路径一致
- 数据库仅 PostgreSQL，必须设置 DATABASE_URL=postgres://...
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _env(key: str, default: str | None = None) -> str | None:
    value = os.getenv(key)
    return value if value not in (None, "") else default


SECRET_KEY = _env("DJANGO_SECRET_KEY", "dev-only-change-me")
DEBUG = (_env("DJANGO_DEBUG", "true") or "true").lower() in ("1", "true", "yes")
ALLOWED_HOSTS = [
    h.strip()
    for h in (_env("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1") or "").split(",")
    if h.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "django_filters",
    "core",
    "iam",
    "datasources",
    "jobs",
    "executions",
    "sso",
    "org_sync",
    "audit",
    "monitor",
    "open_api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "core.middleware.StripTrailingSlashMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "core.middleware.RequestContextMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ------------------------------------------------------------
# 数据库（仅 PostgreSQL）
# ------------------------------------------------------------
_db_url = _env("DATABASE_URL")
if not _db_url or not _db_url.startswith("postgres"):
    raise RuntimeError(
        "必须设置 DATABASE_URL=postgres://user:pass@host:port/dbname"
    )

parsed = urlparse(_db_url)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.lstrip("/"),
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "127.0.0.1",
        "PORT": str(parsed.port or 5432),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# 前端 URL 无尾斜杠：/api/users 而非 /api/users/
APPEND_SLASH = False

# ------------------------------------------------------------
# CORS
# ------------------------------------------------------------
CORS_ALLOW_CREDENTIALS = True
if DEBUG:
    # 开发环境允许本机任意端口（端口占用顺延 +1 时无需改配置）
    CORS_ALLOW_ALL_ORIGINS = True
else:
    CORS_ALLOWED_ORIGINS = [
        o.strip()
        for o in (_env("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5004,http://127.0.0.1:5004") or "").split(",")
        if o.strip()
    ]
CORS_ALLOW_HEADERS = ["*"]

# ------------------------------------------------------------
# DRF：camelCase 渲染/解析，JWT 认证，统一分页与异常
# ------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "core.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "core.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "djangorestframework_camel_case.render.CamelCaseJSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "djangorestframework_camel_case.parser.CamelCaseJSONParser",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.PageSizePagination",
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
}

# 仅忽略键名本身已是 camelCase 的嵌套对象（如数据源 config.baseUrl）。
# 不可忽略 source_config / field_mapping：忽略后顶层不会转成 sourceConfig / fieldMapping，
# 创建任务时前端字段会丢，详情回填也会对不上。
JSON_CAMEL_CASE = {
    "JSON_UNDERSCOREIZE": {
        "no_underscore_before_number": True,
        "ignore_fields": (
            "config",
            "settings",
            "payload",
            "changes",
            "snapshot_data",
            "detail",
            "ip_whitelist",
            "user_info",
            "attributes",
        ),
        "ignore_keys": (
            "config",
            "settings",
            "payload",
            "changes",
            "snapshotData",
            "detail",
            "ipWhitelist",
            "userInfo",
            "attributes",
        ),
    },
}

# ------------------------------------------------------------
# JWT / 加密 / 队列
# ------------------------------------------------------------
JWT_SECRET = _env("JWT_SECRET", "integration-platform-jwt-secret-2024")
JWT_ACCESS_EXPIRES = _env("JWT_ACCESS_EXPIRES", "8h")
JWT_REFRESH_EXPIRES = _env("JWT_REFRESH_EXPIRES", "7d")
ENCRYPTION_KEY = _env("ENCRYPTION_KEY", "integration-platform-secret-key-2024")
# SSO RS256 非对称密钥（P0：B 系统 SDK 通过 JWKS 公钥本地验签，无需保管 secretKey）
# 生产必须配置；开发留空时自动生成临时密钥（每次重启变化）。
SSO_RSA_PRIVATE_KEY = _env("SSO_RSA_PRIVATE_KEY", "")
SSO_RSA_PUBLIC_KEY = _env("SSO_RSA_PUBLIC_KEY", "")
QUEUE_BACKEND = _env("QUEUE_BACKEND", "memory")
REDIS_URL = _env("REDIS_URL", "")
# 部署模式：private=私有化（配额超限仅告警，不拦截）；saas=SaaS（超限拒绝）。
# 客户数据隔离（client_id）在两种模式下都强制生效。
DEPLOYMENT_MODE = (_env("DEPLOYMENT_MODE", "private") or "private").strip().lower()
if DEPLOYMENT_MODE not in ("private", "saas"):
    DEPLOYMENT_MODE = "private"
ENVIRONMENT = (_env("ENVIRONMENT", "dev") or "dev").strip().lower()
# ── 对外 URL 口径（Nginx/网关反代场景的关键配置）─────────────────────────────
# PUBLIC_BASE_URL：集成商访问本平台的对外 origin（含 scheme，不含路径/尾斜杠）
_raw_base = (_env("PUBLIC_BASE_URL", "http://127.0.0.1:8000") or "http://127.0.0.1:8000").rstrip("/")
_parsed_base = urlparse(_raw_base)
if not _parsed_base.scheme or not _parsed_base.netloc:
    # 兼容只填了 host 的写法
    _raw_base = f"http://{_raw_base.lstrip('/')}"
    _parsed_base = urlparse(_raw_base)
PUBLIC_BASE_URL = f"{_parsed_base.scheme}://{_parsed_base.netloc}"


def _normalize_prefix(raw: str) -> str:
    """API 路径前缀：保证以 / 开头、无尾斜杠；根域名暴露时为空串。"""
    raw = (raw or "").strip()
    if raw in ("", "/"):
        return ""
    if not raw.startswith("/"):
        raw = "/" + raw
    return raw.rstrip("/")


# PUBLIC_API_PREFIX：API 对外暴露路径（与 Nginx location 口径一致，默认 /api；
# API 直接在根域名暴露时填 /）。误把路径写进 PUBLIC_BASE_URL 且未显式配前缀时自动吸收。
_explicit_prefix = _env("PUBLIC_API_PREFIX", None)
if _explicit_prefix is not None:
    PUBLIC_API_PREFIX = _normalize_prefix(_explicit_prefix)
else:
    PUBLIC_API_PREFIX = _normalize_prefix(_parsed_base.path) or "/api"

PUBLIC_API_BASE_URL = (PUBLIC_BASE_URL + PUBLIC_API_PREFIX).rstrip("/")

# SSO/OIDC 签发者：标准 OIDC 库（next-auth / python-social-auth）要求 iss 为 URL；
# 默认与对外 API 基址完全一致，保证 discovery 内 issuer 与各端点同口径
SSO_ISSUER = (_env("SSO_ISSUER", PUBLIC_API_BASE_URL) or PUBLIC_API_BASE_URL).rstrip("/")

# 信任反代转发头：生产经 Nginx 时设 true，Django 才会依据 X-Forwarded-*
# 还原真实 scheme/host（影响 get_host()、重定向、request.scheme）。
# discovery 的 URL 始终走上面的静态口径，不依赖此开关。
TRUST_PROXY_HEADERS = (_env("TRUST_PROXY_HEADERS", "false") or "false").lower() in ("1", "true", "yes")
if TRUST_PROXY_HEADERS:
    USE_X_FORWARDED_HOST = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# 控制台登录页地址（OAuth2 授权码浏览器流程：未登录用户会被 /oauth/authorize
# 302 重定向到此地址，登录成功后控制台需带 token 跳回 authorize 完成授权）
# 生产同源时默认 PUBLIC_BASE_URL + /login；开发态 Next.js 在另一端口需显式配置
CONSOLE_LOGIN_URL = (_env("CONSOLE_LOGIN_URL", "") or "").rstrip("/") or f"{PUBLIC_BASE_URL}/login"
OPEN_REGISTER_ENABLED = (_env("OPEN_REGISTER_ENABLED", "true") or "true").lower() in ("1", "true", "yes")
OPEN_REGISTER_INVITE = _env("OPEN_REGISTER_INVITE", "") or ""
OPEN_SANDBOX_CALL_QUOTA = int(_env("OPEN_SANDBOX_CALL_QUOTA", "10000") or "10000")
OPEN_SANDBOX_ROW_QUOTA = int(_env("OPEN_SANDBOX_ROW_QUOTA", "100000") or "100000")

SMTP_HOST = _env("SMTP_HOST", "") or ""
SMTP_PORT = int(_env("SMTP_PORT", "587") or "587")
SMTP_USER = _env("SMTP_USER", "") or ""
SMTP_PASSWORD = _env("SMTP_PASSWORD", "") or ""
SMTP_FROM = _env("SMTP_FROM", "") or ""
SMTP_USE_TLS = (_env("SMTP_USE_TLS", "true") or "true").lower() in ("1", "true", "yes")

# 登录限流：每 IP 每分钟 5 次（与规划一致）
LOGIN_RATE_LIMIT = 5
LOGIN_RATE_WINDOW_SECONDS = 60

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "[{asctime}] {levelname} {name}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}
