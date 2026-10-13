"""License 校验（离线签名，私有化商用标配）。

公私钥签一个 license.json，部署时放 PROJECT_ROOT/license.json，
后端校验签名 + 客户 ID + 产品版本 + 到期时间 + 授权配额。
不是在线激活，不联网。License 校验失败只 warning，不阻断。
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import date, datetime
from pathlib import Path

logger = logging.getLogger(__name__)


def _project_root() -> Path:
    """PROJECT_ROOT 指 backend/ 的上一级，便于运维挂载 license.json。"""
    from django.conf import settings

    base = getattr(settings, "BASE_DIR", None)
    if base:
        return Path(base).resolve().parent
    return Path(__file__).resolve().parent.parent.parent


def _license_path(path: str | None = None) -> Path:
    if path:
        return Path(path).expanduser().resolve()
    from django.conf import settings

    fname = getattr(settings, "LICENSE_FILE", "license.json") or "license.json"
    # 绝对路径直接用，否则相对于 PROJECT_ROOT
    p = Path(fname).expanduser()
    if p.is_absolute():
        return p
    return (_project_root() / fname).resolve()


def _public_key_path() -> Path:
    from django.conf import settings

    base = getattr(settings, "BASE_DIR", None)
    if base:
        return Path(base).resolve() / "config" / "public_key.pem"
    return Path(__file__).resolve().parent.parent / "config" / "public_key.pem"


def _match_version(license_version: str, platform_version: str) -> bool:
    """接受 major.minor 匹配，比如 1.6.x 能跑 1.6.0 的 license。"""
    if not license_version or not platform_version:
        return True
    lic_parts = [int(x) if x.isdigit() else 0 for x in license_version.split(".")]
    plat_parts = [int(x) if x.isdigit() else 0 for x in platform_version.split(".")]
    if len(plat_parts) >= 2 and len(lic_parts) >= 2:
        return lic_parts[0] == plat_parts[0] and lic_parts[1] == plat_parts[1]
    return license_version == platform_version


def load_license(path: str | None = None) -> dict | None:
    """加载 + base64 验签 + 字段校验。失败返回 None 并记 warning。"""
    try:
        import cryptography
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
    except ImportError:
        logger.warning("cryptography 未安装，License 校验跳过")
        return None

    fpath = _license_path(path)
    if not fpath.is_file():
        return None

    try:
        raw = json.loads(fpath.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("license.json 解析失败: %s", exc)
        return None

    signature_b64 = raw.get("signature")
    payload = raw.get("payload")
    if not signature_b64 or not isinstance(payload, dict):
        logger.warning("license.json 缺少 signature 或 payload")
        return None

    # 重新序列化 payload 时保持 key 顺序与原始 JSON 一致（生成端按 canonical json 输出）
    try:
        payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        signature = base64.urlsafe_b64decode(signature_b64 + "=" * (-len(signature_b64) % 4))
    except Exception as exc:
        logger.warning("license.json 签名 base64 解码失败: %s", exc)
        return None

    pub_path = _public_key_path()
    if not pub_path.is_file():
        logger.warning("未找到 public_key.pem，License 验签跳过")
        return None

    try:
        from cryptography.hazmat.primitives import serialization

        pub_key = serialization.load_pem_public_key(pub_path.read_bytes())
        pub_key.verify(signature, payload_bytes)
    except InvalidSignature:
        logger.warning("license.json 签名无效")
        return None
    except Exception as exc:
        logger.warning("license.json 验签异常: %s", exc)
        return None

    # 字段校验
    from django.conf import settings

    today = date.today().isoformat()
    expire = str(payload.get("expire_date") or "")
    if expire and expire < today:
        logger.warning("license.json 已过期: expire_date=%s", expire)
        return None

    if not (payload.get("customer") and str(payload.get("customer")).strip()):
        logger.warning("license.json 缺少 customer")
        return None
    if not (payload.get("client_id") and str(payload.get("client_id")).strip()):
        logger.warning("license.json 缺少 client_id")
        return None

    plat_ver = getattr(settings, "PLATFORM_VERSION", "") or ""
    lic_ver = str(payload.get("platform_version") or "")
    if lic_ver and plat_ver and not _match_version(lic_ver, plat_ver):
        logger.warning(
            "license.json 版本不匹配: license=%s platform=%s", lic_ver, plat_ver
        )
        return None

    return payload


def get_effective_entitlements(client_id: str) -> dict:
    """License 中的授权字段是硬性上限（0 表示不限制）。

    无 license 时返回全 0（等于私有化默认不限）。
    调用方需要用 min(DB_limit, license_limit) 来得到最终值。
    """
    payload = load_license()
    if payload is None:
        return {
            "max_jobs": 0,
            "max_seats": 0,
            "max_connectors": 0,
            "max_rows_monthly": 0,
            "max_api_calls_monthly": 0,
        }

    # 校验 client_id 是否匹配（多客户共用一个平台实例时，license 的 client_id 应等于 "*" 或具体值）
    lic_client = str(payload.get("client_id") or "")
    if lic_client not in ("*", str(client_id)):
        logger.warning(
            "license.json client_id=%s 与请求 client_id=%s 不匹配，授权视为 0",
            lic_client, client_id,
        )
        return {
            "max_jobs": 0,
            "max_seats": 0,
            "max_connectors": 0,
            "max_rows_monthly": 0,
            "max_api_calls_monthly": 0,
        }

    def _int(key: str) -> int:
        try:
            return max(0, int(payload.get(key) or 0))
        except (TypeError, ValueError):
            return 0

    return {
        "max_jobs": _int("max_jobs"),
        "max_seats": _int("max_seats"),
        "max_connectors": _int("max_connectors"),
        "max_rows_monthly": _int("max_rows_monthly"),
        "max_api_calls_monthly": _int("max_api_calls_monthly"),
    }
