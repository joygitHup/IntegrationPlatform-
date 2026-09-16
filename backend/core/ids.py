"""
短 ID 生成器。

与前端 src/server/utils/id.ts 对齐：时间戳 base36 + 随机字符，可选前缀。
"""
from __future__ import annotations

import secrets
import time
import hashlib
import uuid


def generate_id(prefix: str = "") -> str:
    """生成短字符串主键，例如 `m1abcXYZ` 或 `job_m1abcXYZ`。"""
    timestamp = format(int(time.time() * 1000), "x")  # 比 base36 更紧凑且兼容
    # 使用与 Node randomBytes(6).toString('base64url') 同量级的随机串
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    random = "".join(secrets.choice(alphabet) for _ in range(8))
    body = f"{timestamp}{random}"
    return f"{prefix}_{body}" if prefix else body


def generate_trace_id() -> str:
    return uuid.uuid4().hex


def md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
