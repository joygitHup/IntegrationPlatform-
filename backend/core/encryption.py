"""
AES-256-CBC 加解密，格式与 Node 端 encryption.ts 对齐：`iv_b64:cipher_b64`。

密钥派生：scrypt(secret, salt='salt', dkLen=32)，与 Node scryptSync 默认参数一致。
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from django.conf import settings


def _get_key() -> bytes:
    secret = getattr(settings, "ENCRYPTION_KEY", None) or os.getenv(
        "ENCRYPTION_KEY", "integration-platform-secret-key-2024"
    )
    return hashlib.scrypt(secret.encode("utf-8"), salt=b"salt", n=16384, r=8, p=1, dklen=32)


def encrypt(plain_text: str) -> str:
    if not plain_text:
        return plain_text
    iv = secrets.token_bytes(16)
    cipher = Cipher(algorithms.AES(_get_key()), modes.CBC(iv))
    encryptor = cipher.encryptor()
    data = plain_text.encode("utf-8")
    pad_len = 16 - (len(data) % 16)
    data += bytes([pad_len] * pad_len)
    encrypted = encryptor.update(data) + encryptor.finalize()
    return f"{base64.b64encode(iv).decode()}:{base64.b64encode(encrypted).decode()}"


def decrypt(encrypted_text: str) -> str:
    if not encrypted_text:
        return encrypted_text
    try:
        parts = encrypted_text.split(":")
        if len(parts) != 2:
            # 旧明文数据或被手动改过：直接返回
            return encrypted_text
        iv = base64.b64decode(parts[0])
        encrypted = base64.b64decode(parts[1])
        cipher = Cipher(algorithms.AES(_get_key()), modes.CBC(iv))
        decryptor = cipher.decryptor()
        data = decryptor.update(encrypted) + decryptor.finalize()
        pad_len = data[-1]
        if 1 <= pad_len <= 16:
            data = data[:-pad_len]
        return data.decode("utf-8")
    except Exception as exc:
        import logging

        logger = logging.getLogger(__name__)
        # 解密失败 = 密钥变了 / 密文被改 / 数据库里混了明文
        # 绝不静默返回 encrypted_text（下游拿到乱串当明文用等于加密失效）
        logger.exception("解密失败，密钥或密文不匹配: %s", type(exc).__name__)
        raise


def mask_sensitive(value: str, keep_start: int = 3, keep_end: int = 2) -> str:
    if not value or len(value) <= keep_start + keep_end:
        return "***"
    middle = "*" * min(len(value) - keep_start - keep_end, 10)
    return f"{value[:keep_start]}{middle}{value[-keep_end:]}"


def is_encrypted(value: str) -> bool:
    if not value:
        return False
    parts = value.split(":")
    return len(parts) == 2 and len(parts[0]) >= 20
