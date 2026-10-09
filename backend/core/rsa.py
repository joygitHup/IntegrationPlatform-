"""SSO 非对称密钥管理（RS256）。

设计要点：
- 中台持 RSA 私钥，签发 SSO JWT；公钥通过 JWKS 端点公开。
- B 系统 SDK 拉 JWKS 自动验签，无需保管任何密钥。
- 无 SSO_RSA_PRIVATE_KEY 配置时：开发模式自动生成临时密钥（每次进程重启变化，
  生产必须配置环境变量）。
- 同时支持 per-app HS256（向后兼容老应用）。
"""
from __future__ import annotations

import base64
import os
import threading
from functools import lru_cache

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


_LOCK = threading.Lock()
_KID = "sso-default"


def _ensure_keys() -> tuple[str, str]:
    """返回 (private_pem, public_pem)。无配置时生成临时密钥（开发用）。"""
    priv = os.getenv("SSO_RSA_PRIVATE_KEY", "") or ""
    pub = os.getenv("SSO_RSA_PUBLIC_KEY", "") or ""
    if priv and pub:
        return priv, pub
    with _LOCK:
        priv2 = os.getenv("SSO_RSA_PRIVATE_KEY", "") or ""
        pub2 = os.getenv("SSO_RSA_PUBLIC_KEY", "") or ""
        if priv2 and pub2:
            return priv2, pub2
        key = rsa.generate_private_key(
            public_exponent=65537, key_size=2048, backend=default_backend()
        )
        priv_pem = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")
        pub_pem = key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8")
        os.environ["SSO_RSA_PRIVATE_KEY"] = priv_pem
        os.environ["SSO_RSA_PUBLIC_KEY"] = pub_pem
        return priv_pem, pub_pem


@lru_cache(maxsize=1)
def get_private_key() -> str:
    """RSA 私钥 PEM 文本（用于 PyJWT RS256 签发）。"""
    return _ensure_keys()[0]


@lru_cache(maxsize=1)
def get_public_key() -> str:
    """RSA 公钥 PEM 文本（用于本地验签测试）。"""
    return _ensure_keys()[1]


def _b64url_uint(n: int) -> str:
    """整数转 base64url 无 padding（JWKS n/e 字段格式）。"""
    length = (n.bit_length() + 7) // 8
    raw = n.to_bytes(length, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


@lru_cache(maxsize=1)
def get_public_jwk() -> dict:
    """返回 JWKS keys 数组中的单个公钥 dict。"""
    pub_pem = get_public_key()
    pub = serialization.load_pem_public_key(
        pub_pem.encode("utf-8"), backend=default_backend()
    )
    numbers = pub.public_numbers()
    return {
        "kty": "RSA",
        "kid": _KID,
        "use": "sig",
        "alg": "RS256",
        "n": _b64url_uint(numbers.n),
        "e": _b64url_uint(numbers.e),
    }


def get_jwks() -> dict:
    """返回完整 JWKS 文档 `{"keys": [...]}`。"""
    return {"keys": [get_public_jwk()]}


def get_kid() -> str:
    """返回当前 kid，签发时写入 header，验签时据此匹配。"""
    return _KID
