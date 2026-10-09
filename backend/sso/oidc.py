"""OIDC 发现端点：暴露标准 OAuth2 / OIDC 元信息。

  GET /api/sso/.well-known/openid-configuration
  → {
      "issuer": "<对外 API 基址>",
      "authorization_endpoint": "<对外 API 基址>/oauth/authorize",
      ...
    }

让 A/B 系统可用任意标准 OAuth2 客户端库接入（python-social-auth、next-auth）。

重要：所有 URL 一律取自 core.public_urls 的静态口径（PUBLIC_BASE_URL +
PUBLIC_API_PREFIX），不使用 request.build_absolute_uri()——否则经 Nginx
反代后会按内网 Host 生成集成商不可达的端点，且与 issuer 口径不一致。
"""
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from core.public_urls import api_url, canonical_issuer
from core.rsa import get_kid


class OidcDiscoveryView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    # OIDC Discovery 字段名由协议规定（jwks_uri/authorization_endpoint…），
    # 必须绕过全局 CamelCase 渲染器，否则标准 OIDC 库无法解析
    renderer_classes = [JSONRenderer]

    def get(self, request):
        return Response({
            "issuer": canonical_issuer(),
            "authorization_endpoint": api_url("/oauth/authorize"),
            "token_endpoint": api_url("/oauth/token"),
            "userinfo_endpoint": api_url("/oauth/userinfo"),
            "jwks_uri": api_url("/sso/.well-known/jwks.json"),
            "response_types_supported": ["code", "token", "id_token"],
            "grant_types_supported": [
                "authorization_code",
                "refresh_token",
            ],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256", "HS256"],
            "scopes_supported": ["openid", "profile", "email", "roles"],
            "token_endpoint_auth_methods_supported": [
                "client_secret_basic",
                "client_secret_post",
                "none",
            ],
            "claims_supported": [
                "sub", "username", "email", "displayName", "roleId",
            ],
            "code_challenge_methods_supported": ["S256", "plain"],
            "revocation_endpoint": api_url("/auth/logout"),
            "end_session_endpoint": api_url("/auth/logout"),
            "kid": get_kid(),
        })
