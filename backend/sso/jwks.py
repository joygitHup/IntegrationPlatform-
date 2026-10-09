"""JWKS 端点：公开 RSA 公钥供 B 系统 SDK 验签。

  GET /api/sso/.well-known/jwks.json
  GET /api/sso/.well-known/openid-configuration  （OIDC 发现，P2 补完）
"""
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from core.rsa import get_jwks


class JwksView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    # JWKS 是标准协议文档，字段名（keys/kid/n/e/alg…）不允许 camelCase 改写
    renderer_classes = [JSONRenderer]

    def get(self, request):
        return Response(get_jwks())
