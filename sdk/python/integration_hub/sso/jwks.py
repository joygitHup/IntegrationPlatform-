"""JWKS 公钥缓存工具（PyJWT 2.9+ 内置 PyJWKClient）。"""
from __future__ import annotations

from functools import lru_cache

import jwt


@lru_cache(maxsize=1)
def _client(platform_url: str):
    """单例 PyJWKClient，自动缓存签名密钥（PyJWT 2.9+ 兼容，不用 cache_jwks）。"""
    kwargs = {"cache_keys": True}
    try:
        return jwt.PyJWKClient(
            f"{platform_url.rstrip('/')}/api/sso/.well-known/jwks.json",
            **kwargs,
        )
    except TypeError:
        # 极老版本 PyJWKClient 不支持 cache_keys
        return jwt.PyJWKClient(
            f"{platform_url.rstrip('/')}/api/sso/.well-known/jwks.json",
        )


def get_signing_key(token: str, platform_url: str):
    """从 JWKS 拉取匹配 token 的 kid 的公钥。"""
    return _client(platform_url).get_signing_key_from_jwt(token)
