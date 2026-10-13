"""SFTP / FTP / S3 / CSV·Excel 真实 Extract / Load。"""
from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any


class DriverMissing(RuntimeError):
    pass


def _limit(job_cfg: dict) -> int:
    try:
        return max(1, min(int(job_cfg.get("batch_size") or 1000), 100000))
    except (TypeError, ValueError):
        return 1000


def _remote_path(config: dict, job_cfg: dict) -> str:
    return str(job_cfg.get("path") or job_cfg.get("table") or config.get("remotePath") or config.get("filePath") or "")


def _parse_tabular(raw: bytes | str, filename: str = "") -> list[dict]:
    text = raw.decode("utf-8-sig", "ignore") if isinstance(raw, (bytes, bytearray)) else str(raw)
    name = filename.lower()
    stripped = text.strip()
    if name.endswith(".json") or stripped.startswith("{") or stripped.startswith("["):
        try:
            data = json.loads(stripped)
        except json.JSONDecodeError:
            data = None
        if isinstance(data, list):
            return [x for x in data if isinstance(x, dict)]
        if isinstance(data, dict):
            for key in ("data", "items", "records", "rows"):
                if isinstance(data.get(key), list):
                    return [x for x in data[key] if isinstance(x, dict)]
            return [data]
    if name.endswith((".xlsx", ".xls")):
        try:
            import openpyxl
        except ImportError as exc:
            raise DriverMissing("读取 Excel 需要 openpyxl。请 pip install openpyxl") from exc
        wb = openpyxl.load_workbook(io.BytesIO(raw if isinstance(raw, (bytes, bytearray)) else text.encode()), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        headers = [str(h or f"col{i}") for i, h in enumerate(next(rows_iter, []))]
        result = []
        for row in rows_iter:
            result.append({headers[i]: row[i] if i < len(row) else None for i in range(len(headers))})
        return result
    reader = csv.DictReader(io.StringIO(text))
    return [dict(r) for r in reader]


def _to_csv(rows: list[dict]) -> str:
    if not rows:
        return ""
    fields = list(rows[0].keys())
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def sftp_client(config: dict):
    try:
        import paramiko
    except ImportError as exc:
        raise DriverMissing("未安装 paramiko，无法连接 SFTP。请 pip install paramiko") from exc
    host = str(config.get("host") or "")
    if not host:
        raise RuntimeError("SFTP 缺少 host")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: dict[str, Any] = {
        "hostname": host,
        "port": int(config.get("port") or 22),
        "username": str(config.get("username") or config.get("user") or ""),
        "timeout": int(config.get("connectTimeout") or 15),
    }
    key = config.get("privateKey")
    if key:
        kwargs["pkey"] = paramiko.RSAKey.from_private_key(io.StringIO(str(key)))
    else:
        kwargs["password"] = str(config.get("password") or "")
    client.connect(**kwargs)
    return client, client.open_sftp()


def sftp_test(config: dict) -> dict:
    try:
        ssh, sftp = sftp_client(config)
        sftp.listdir(str(config.get("remotePath") or "."))
        sftp.close()
        ssh.close()
        return {"success": True, "message": "SFTP 连接成功"}
    except DriverMissing as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def sftp_extract(config: dict, job_cfg: dict) -> list[dict]:
    path = _remote_path(config, job_cfg)
    if not path:
        raise RuntimeError("请填写 remotePath 或 sourceConfig.path")
    ssh, sftp = sftp_client(config)
    try:
        with sftp.file(path, "rb") as fh:
            raw = fh.read()
        return _parse_tabular(raw, path)[: _limit(job_cfg)]
    finally:
        sftp.close()
        ssh.close()


def sftp_load(config: dict, job_cfg: dict, row: dict) -> None:
    import logging

    logger = logging.getLogger(__name__)
    path = _remote_path(config, job_cfg)
    if not path:
        raise RuntimeError("请填写目标文件路径")
    ssh, sftp = sftp_client(config)
    try:
        existing = ""
        try:
            with sftp.file(path, "rb") as fh:
                existing = fh.read().decode("utf-8", "ignore")
        except Exception as exc:
            logger.debug("SFTP 目标文件不存在或不可读 path=%s: %s", path, exc)
        rows = _parse_tabular(existing, path) if existing.strip() else []
        rows.append(row)
        data = _to_csv(rows).encode("utf-8")
        with sftp.file(path, "wb") as fh:
            fh.write(data)
    finally:
        sftp.close()
        ssh.close()


def ftp_connect(config: dict):
    from ftplib import FTP

    ftp = FTP()
    ftp.connect(str(config.get("host") or ""), int(config.get("port") or 21), timeout=int(config.get("connectTimeout") or 15))
    ftp.login(str(config.get("username") or config.get("user") or ""), str(config.get("password") or ""))
    return ftp


def ftp_test(config: dict) -> dict:
    try:
        ftp = ftp_connect(config)
        ftp.pwd()
        ftp.quit()
        return {"success": True, "message": "FTP 连接成功"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def ftp_extract(config: dict, job_cfg: dict) -> list[dict]:
    path = _remote_path(config, job_cfg)
    if not path:
        raise RuntimeError("请填写 FTP 文件路径")
    ftp = ftp_connect(config)
    buf = io.BytesIO()
    try:
        ftp.retrbinary(f"RETR {path}", buf.write)
        return _parse_tabular(buf.getvalue(), path)[: _limit(job_cfg)]
    finally:
        ftp.quit()


def ftp_load(config: dict, job_cfg: dict, row: dict) -> None:
    path = _remote_path(config, job_cfg)
    if not path:
        raise RuntimeError("请填写 FTP 目标路径")
    rows = [row]
    data = _to_csv(rows).encode("utf-8")
    ftp = ftp_connect(config)
    try:
        ftp.storbinary(f"STOR {path}", io.BytesIO(data))
    finally:
        ftp.quit()


def s3_client(config: dict):
    try:
        import boto3
        from botocore.config import Config as BotoConfig
    except ImportError as exc:
        raise DriverMissing("未安装 boto3，无法连接 S3。请 pip install boto3") from exc
    kwargs: dict[str, Any] = {
        "aws_access_key_id": str(config.get("accessKeyId") or ""),
        "aws_secret_access_key": str(config.get("secretAccessKey") or ""),
        "region_name": str(config.get("region") or "us-east-1"),
        "config": BotoConfig(connect_timeout=10, read_timeout=30),
    }
    endpoint = str(config.get("endpoint") or "")
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    return boto3.client("s3", **kwargs)


def s3_test(config: dict) -> dict:
    try:
        client = s3_client(config)
        bucket = str(config.get("bucket") or "")
        if not bucket:
            return {"success": False, "message": "缺少 bucket"}
        client.head_bucket(Bucket=bucket)
        return {"success": True, "message": "S3 连接成功"}
    except DriverMissing as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def s3_extract(config: dict, job_cfg: dict) -> list[dict]:
    key = _remote_path(config, job_cfg) or str(config.get("key") or "")
    bucket = str(config.get("bucket") or "")
    if not bucket or not key:
        raise RuntimeError("S3 需要 bucket 与对象 key（sourceConfig.path）")
    client = s3_client(config)
    obj = client.get_object(Bucket=bucket, Key=key)
    raw = obj["Body"].read()
    return _parse_tabular(raw, key)[: _limit(job_cfg)]


def s3_load(config: dict, job_cfg: dict, row: dict) -> None:
    key = _remote_path(config, job_cfg) or str(config.get("key") or "")
    bucket = str(config.get("bucket") or "")
    if not bucket or not key:
        raise RuntimeError("S3 需要 bucket 与对象 key")
    client = s3_client(config)
    body = json.dumps(row, ensure_ascii=False, default=str).encode("utf-8")
    suffix = f"{row.get('id') or row.get('_id') or hash(json.dumps(row, sort_keys=True, default=str))}.json"
    target = key.rstrip("/") + "/" + suffix if not key.lower().endswith((".json", ".csv")) else key
    client.put_object(Bucket=bucket, Key=target, Body=body, ContentType="application/json")


def csv_extract(config: dict, job_cfg: dict) -> list[dict]:
    import logging

    logger = logging.getLogger(__name__)
    path = _remote_path(config, job_cfg)
    if not path:
        raise RuntimeError("请填写 filePath")
    p = Path(path)
    if not p.exists():
        raise RuntimeError(f"文件不存在: {path}")
    raw = p.read_bytes()
    encoding = str(config.get("encoding") or "utf-8")
    if not path.lower().endswith((".xlsx", ".xls")):
        try:
            raw = raw.decode(encoding).encode("utf-8")
        except Exception as exc:
            logger.warning("文件 %s 编码 %s 解码失败，按原始字节继续: %s", path, encoding, exc)
    return _parse_tabular(raw, path)[: _limit(job_cfg)]


def csv_load(config: dict, job_cfg: dict, row: dict) -> None:
    path = _remote_path(config, job_cfg)
    if not path:
        raise RuntimeError("请填写目标 filePath")
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    if p.exists():
        rows = _parse_tabular(p.read_bytes(), path)
    rows.append(row)
    p.write_text(_to_csv(rows), encoding=str(config.get("encoding") or "utf-8"), newline="")


def csv_test(config: dict) -> dict:
    path = str(config.get("filePath") or "")
    if not path:
        return {"success": False, "message": "缺少 filePath"}
    p = Path(path)
    if p.exists():
        return {"success": True, "message": f"文件可读: {p.name}"}
    if p.parent.exists():
        return {"success": True, "message": "目录存在，文件将在写入时创建"}
    return {"success": False, "message": f"路径不存在: {path}"}


def inspect_file(kind: str, config: dict, job_cfg: dict | None = None) -> dict:
    job_cfg = {**(job_cfg or {}), "sync_mode": "full", "batch_size": 20}
    extractors = {
        "sftp": sftp_extract,
        "ftp": ftp_extract,
        "s3": s3_extract,
        "csv_excel": csv_extract,
    }
    fn = extractors[kind]
    try:
        sample = fn(config, job_cfg)[:20]
    except Exception as exc:
        return {"dialect": kind, "tables": [], "columns": [], "sample": [], "message": str(exc)}
    columns = [{"name": k, "type": type(v).__name__} for k, v in (sample[0].items() if sample else [])]
    return {"dialect": kind, "tables": [], "columns": columns, "sample": sample}
