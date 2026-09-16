"""
密码哈希：bcrypt，与 Node bcrypt / @node-rs/bcrypt 产物互相可校验。
创建/改密做强度校验；登录只比对哈希，不套用本策略。
"""
from __future__ import annotations

import re

import bcrypt

WEAK_PASSWORDS = frozenset(
    {
        "12345678",
        "123456789",
        "password",
        "password1",
        "qwerty12",
        "abc12345",
        "11111111",
        "00000000",
        "admin8888",
        "admin888",
    }
)


def validate_password(plain: str, *, username: str = "") -> None:
    from core.exceptions import ApiError

    if not plain or len(plain) < 8:
        raise ApiError("密码至少 8 位，须同时包含字母和数字", 400)
    if len(plain) > 128:
        raise ApiError("密码过长", 400)
    if username and plain.lower() == username.lower():
        raise ApiError("密码不能与用户名相同", 400)
    if not re.search(r"[A-Za-z]", plain) or not re.search(r"\d", plain):
        raise ApiError("密码须同时包含字母和数字", 400)
    if plain.lower() in WEAK_PASSWORDS:
        raise ApiError("密码过于简单，请更换", 400)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False
