"""生成 License 公私钥（私有化交付时签发给客户）。

一次性生成密钥对：
    python scripts/generate_license.py gen-keys
    → 写到 backend/config/private_key.pem 和 public_key.pem
      （private 要妥善保管，不要进 git）

签发给客户：
    python scripts/generate_license.py sign --customer "客户公司名" --client-id "cust_xxx" \
        --expire 2027-12-31 --max-jobs 30 --max-seats 100 --max-rows-monthly 5000000 \
        --out license.json
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
from datetime import datetime
from pathlib import Path


def _config_dir() -> Path:
    """backend/config/。"""
    return Path(__file__).resolve().parent.parent / "config"


def _platform_version() -> str:
    ver_file = _config_dir() / "version.py"
    if ver_file.is_file():
        for line in ver_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("VERSION") and "=" in line:
                val = line.split("=", 1)[1].strip().strip("\"'")
                return val
    return "0.0.0"


def _gen_keys() -> None:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )

    cfg = _config_dir()
    cfg.mkdir(parents=True, exist_ok=True)

    private_key = Ed25519PrivateKey.generate()
    public_key: Ed25519PublicKey = private_key.public_key()

    priv_path = cfg / "private_key.pem"
    pub_path = cfg / "public_key.pem"

    priv_path.write_bytes(
        private_key.private_bytes(
            encoding=__import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.PEM,
            format=__import__("cryptography.hazmat.primitives.serialization", fromlist=["PrivateFormat"]).PrivateFormat.PKCS8,
            encryption_algorithm=__import__("cryptography.hazmat.primitives.serialization", fromlist=["NoEncryption"]).NoEncryption(),
        )
    )
    pub_path.write_bytes(
        public_key.public_bytes(
            encoding=__import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.PEM,
            format=__import__("cryptography.hazmat.primitives.serialization", fromlist=["PublicFormat"]).PublicFormat.SubjectPublicKeyInfo,
        )
    )
    # 私钥 chmod 0600（Windows 不生效也没关系，gitignore 已经排除）
    print(f"已生成密钥对：\n  私钥 {priv_path}\n  公钥 {pub_path}")
    print("⚠ 私钥务必妥善保管，不要进 git。")


def _sign(args: argparse.Namespace) -> None:
    from cryptography.hazmat.primitives import serialization

    priv_path = _config_dir() / "private_key.pem"
    if not priv_path.is_file():
        print(f"找不到私钥 {priv_path}，请先执行 gen-keys", file=sys.stderr)
        sys.exit(1)

    private_key = serialization.load_pem_private_key(priv_path.read_bytes(), password=None)

    payload = {
        "customer": args.customer,
        "client_id": args.client_id,
        "platform_version": _platform_version(),
        "expire_date": args.expire,
        "max_jobs": int(args.max_jobs or 0),
        "max_seats": int(args.max_seats or 0),
        "max_connectors": int(args.max_connectors or 0),
        "max_rows_monthly": int(args.max_rows_monthly or 0),
        "max_api_calls_monthly": int(args.max_api_calls_monthly or 0),
        "issued_at": datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = private_key.sign(payload_bytes)
    signature_b64 = base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")

    output = {
        "signature": signature_b64,
        "payload": payload,
    }

    out_path = Path(args.out).expanduser().resolve()
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"已签发 license → {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="License 密钥生成与签发工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("gen-keys", help="生成 Ed25519 公私钥对到 backend/config/")

    p_sign = sub.add_parser("sign", help="签发 license.json")
    p_sign.add_argument("--customer", required=True, help="客户公司名")
    p_sign.add_argument("--client-id", required=True, help="客户 client_id（可用 * 通配）")
    p_sign.add_argument("--expire", required=True, help="到期日期 YYYY-MM-DD")
    p_sign.add_argument("--max-jobs", default=0, help="0=不限")
    p_sign.add_argument("--max-seats", default=0, help="0=不限")
    p_sign.add_argument("--max-connectors", default=0, help="0=不限")
    p_sign.add_argument("--max-rows-monthly", default=0, help="0=不限")
    p_sign.add_argument("--max-api-calls-monthly", default=0, help="0=不限")
    p_sign.add_argument("--out", default="license.json", help="输出路径（默认 license.json）")

    args = parser.parse_args()

    if args.cmd == "gen-keys":
        _gen_keys()
    elif args.cmd == "sign":
        _sign(args)


if __name__ == "__main__":
    main()
