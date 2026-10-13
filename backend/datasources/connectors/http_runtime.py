"""HTTP API / Webhook 真实 Extract / Load。"""
from __future__ import annotations

import base64
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def join_url(base: str, path: str = "") -> str:
    base = (base or "").rstrip("/")
    path = (path or "").strip()
    if not path:
        return base
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{base}/{path.lstrip('/')}"


def api_headers(config: dict, *, json_body: bool = False) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if json_body:
        headers["Content-Type"] = "application/json"
    auth = str(config.get("authType") or "none").lower()
    if auth == "bearer" and config.get("token"):
        headers["Authorization"] = f"Bearer {config['token']}"
    elif auth == "basic":
        user = config.get("user") or config.get("username") or ""
        password = config.get("password") or ""
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {token}"
    elif auth in ("apikey", "api_key", "api-key"):
        name = config.get("apiKeyHeader") or "X-Api-Key"
        headers[str(name)] = str(config.get("apiKeyValue") or config.get("token") or "")
    extra = config.get("headers")
    if isinstance(extra, dict):
        headers.update({str(k): str(v) for k, v in extra.items() if v is not None})
    secret = config.get("secret")
    if secret and "X-Webhook-Secret" not in headers:
        headers["X-Webhook-Secret"] = str(secret)
    return headers


def _timeout(config: dict) -> float:
    ms = config.get("timeoutMs") or config.get("timeout") or 15000
    try:
        return max(1.0, float(ms) / (1000.0 if float(ms) > 100 else 1.0))
    except (TypeError, ValueError):
        return 15.0


def http_request(url: str, *, method: str = "GET", headers: dict | None = None, body: bytes | None = None, timeout: float = 15) -> tuple[int, Any]:
    req = Request(url, data=body, headers=headers or {}, method=method.upper())
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            status = getattr(resp, "status", 200) or 200
    except HTTPError as exc:
        raw = exc.read() if exc.fp else b""
        raise RuntimeError(f"HTTP {exc.code}: {(raw or b'').decode('utf-8', 'ignore')[:500]}") from exc
    except URLError as exc:
        raise RuntimeError(f"请求失败: {exc.reason}") from exc
    text = raw.decode("utf-8", "ignore") if raw else ""
    if not text:
        return status, None
    try:
        return status, json.loads(text)
    except json.JSONDecodeError:
        return status, text


def parse_records(payload: Any, data_field: str = "") -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    keys = [data_field, "data", "items", "records", "rows"]
    for key in keys:
        if key and isinstance(payload.get(key), list):
            return [x for x in payload[key] if isinstance(x, dict)]
    return [payload]


def test(config: dict) -> dict:
    url = config.get("baseUrl") or config.get("url") or config.get("endpoint")
    if not url:
        return {"success": False, "message": "缺少 Base URL"}
    try:
        status, _ = http_request(str(url), method="GET", headers=api_headers(config), timeout=_timeout(config))
        if status in (401, 403, 407):
            return {"success": False, "message": f"HTTP {status}，认证失败"}
        if status >= 500:
            return {"success": False, "message": f"HTTP {status}"}
        return {"success": True, "message": f"HTTP {status}"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def extract(config: dict, job_cfg: dict) -> list[dict]:
    path = job_cfg.get("path") or job_cfg.get("table") or config.get("path") or ""
    url = join_url(str(config.get("baseUrl") or config.get("url") or ""), str(path))
    if not url:
        raise RuntimeError("HTTP 数据源缺少 baseUrl / url")
    params: dict[str, str] = {}
    extra = job_cfg.get("query") or config.get("query")
    if isinstance(extra, dict):
        params.update({str(k): str(v) for k, v in extra.items()})
    if job_cfg.get("sync_mode") == "incremental" and job_cfg.get("watermark_field") and job_cfg.get("watermark_value"):
        param_name = str(job_cfg.get("watermark_param") or job_cfg.get("watermark_field"))
        params[param_name] = str(job_cfg.get("watermark_value"))
    if params:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}{urlencode(params)}"
    method = str(job_cfg.get("method") or config.get("method") or "GET").upper()
    _, payload = http_request(
        url,
        method=method,
        headers=api_headers(config),
        timeout=_timeout(config),
    )
    data_field = str(job_cfg.get("data_field") or job_cfg.get("dataField") or config.get("dataField") or "")
    return parse_records(payload, data_field)


def load_row(config: dict, job_cfg: dict, row: dict, *, method: str | None = None, url: str | None = None) -> None:
    path = job_cfg.get("path") or job_cfg.get("table") or config.get("path") or ""
    target = url or join_url(str(config.get("baseUrl") or config.get("url") or ""), str(path))
    if not target:
        raise RuntimeError("HTTP 目标缺少 URL")
    verb = (method or job_cfg.get("method") or config.get("method") or "POST").upper()
    body = json.dumps(row, ensure_ascii=False, default=str).encode("utf-8")
    http_request(
        target,
        method=verb,
        headers=api_headers(config, json_body=True),
        body=body,
        timeout=_timeout(config),
    )


def fetch_existing_map(config: dict, job_cfg: dict, match_keys: list[str]) -> dict[str, dict]:
    import logging

    logger = logging.getLogger(__name__)
    if not match_keys:
        return {}
    try:
        records = extract(config, {**job_cfg, "sync_mode": "full", "watermark_value": ""})
    except Exception as exc:
        logger.warning("fetch_existing_map 拉取已有记录失败: %s", exc)
        return {}
    result: dict[str, dict] = {}
    for rec in records:
        result[_record_key(rec, match_keys)] = rec
    return result


def _record_key(record: dict, match_keys: list[str]) -> str:
    if not match_keys:
        return json.dumps(record, sort_keys=True, default=str)
    return "||".join(str(record.get(k, "")) for k in match_keys)


def inspect_schema(config: dict, job_cfg: dict | None = None) -> dict:
    job_cfg = {**(job_cfg or {}), "sync_mode": "full", "watermark_value": "", "batch_size": 20}
    sample: list[dict] = []
    try:
        sample = extract(config, job_cfg)[:20]
    except Exception as exc:
        return {"dialect": "http", "tables": [], "columns": [], "sample": [], "message": str(exc)}
    columns = []
    if sample:
        columns = [{"name": k, "type": type(v).__name__} for k, v in sample[0].items()]
    return {"dialect": "http", "tables": [], "columns": columns, "sample": sample}
