"""飞书 / 用友 / 纷享销客 / SCIM，以及钉钉/企微/AD 作为 ETL 源。"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode

from datasources.connectors.http_runtime import api_headers, http_request, join_url, parse_records
from datasources.connectors.watermark import filter_rows, query_params
from org_sync.identity import IdentityError, pull_identity


def _limit(job_cfg: dict) -> int:
    try:
        return max(1, min(int(job_cfg.get("batch_size") or 1000), 5000))
    except (TypeError, ValueError):
        return 200


def _entity(job_cfg: dict) -> str:
    return str(job_cfg.get("table") or job_cfg.get("path") or job_cfg.get("entity") or "users").strip().strip("/")


def extract_identity(kind: str, config: dict, job_cfg: dict) -> list[dict]:
    result = pull_identity(kind, config)
    entity = _entity(job_cfg).lower()
    if entity in ("departments", "dept", "department"):
        return filter_rows(list(result.get("departments") or []), job_cfg)[: _limit(job_cfg)]
    rows = []
    for user in result.get("users") or []:
        rows.append({k: v for k, v in user.items() if k != "raw"})
    return filter_rows(rows, job_cfg)[: _limit(job_cfg)]


def inspect_identity(kind: str, config: dict, job_cfg: dict | None = None) -> dict:
    job_cfg = job_cfg or {}
    try:
        sample = extract_identity(kind, config, {**job_cfg, "batch_size": 20})
    except IdentityError as exc:
        return {"dialect": kind, "tables": [{"name": "users"}, {"name": "departments"}], "columns": [], "sample": [], "message": str(exc)}
    columns = [{"name": k, "type": type(v).__name__} for k, v in (sample[0].items() if sample else [])]
    return {
        "dialect": kind,
        "tables": [{"name": "users"}, {"name": "departments"}],
        "columns": columns,
        "sample": sample[:20],
    }


def _feishu_token(config: dict) -> str:
    app_id = config.get("appId") or config.get("app_id")
    secret = config.get("appSecret") or config.get("app_secret")
    if not app_id or not secret:
        raise RuntimeError("飞书缺少 App ID / App Secret")
    _, payload = http_request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        method="POST",
        headers={"Content-Type": "application/json"},
        body=json.dumps({"app_id": app_id, "app_secret": secret}).encode("utf-8"),
        timeout=20,
    )
    token = payload.get("tenant_access_token") if isinstance(payload, dict) else ""
    if not token:
        raise RuntimeError((payload or {}).get("msg") if isinstance(payload, dict) else "飞书获取 token 失败")
    return str(token)


def feishu_test(config: dict) -> dict:
    try:
        _feishu_token(config)
        return {"success": True, "message": "飞书凭证有效"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def feishu_extract(config: dict, job_cfg: dict) -> list[dict]:
    token = _feishu_token(config)
    entity = _entity(job_cfg)
    path = entity if entity.startswith("open-apis") or entity.startswith("http") else f"open-apis/contact/v3/{entity or 'users'}"
    if entity in ("users", "user", ""):
        path = "open-apis/contact/v3/users"
    url = join_url("https://open.feishu.cn", path)
    extra = query_params(job_cfg)
    if extra:
        url = f"{url}{'&' if '?' in url else '?'}{urlencode(extra)}"
    _, payload = http_request(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=20,
    )
    if isinstance(payload, dict) and payload.get("code") not in (0, None):
        raise RuntimeError(payload.get("msg") or "飞书接口失败")
    data = payload.get("data") if isinstance(payload, dict) else payload
    rows = parse_records(data, "items")
    if not rows and isinstance(data, dict):
        rows = parse_records(data.get("items") or data.get("users") or data)
    return filter_rows(rows, job_cfg)[: _limit(job_cfg)]


def feishu_load(config: dict, job_cfg: dict, row: dict) -> None:
    token = _feishu_token(config)
    path = _entity(job_cfg)
    if path in ("users", ""):
        raise RuntimeError("飞书写入请在 targetConfig.path 填写开放接口路径")
    url = join_url("https://open.feishu.cn", path if path.startswith("open-apis") else path)
    http_request(
        url,
        method=str(job_cfg.get("method") or "POST"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        body=json.dumps(row, ensure_ascii=False, default=str).encode("utf-8"),
        timeout=20,
    )


def yonyou_test(config: dict) -> dict:
    url = str(config.get("baseUrl") or "")
    if not url:
        return {"success": False, "message": "缺少接口地址"}
    try:
        status, _ = http_request(url, headers=_yonyou_headers(config), timeout=15)
        if status >= 500:
            return {"success": False, "message": f"HTTP {status}"}
        return {"success": True, "message": f"用友接口可达 HTTP {status}"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def _yonyou_headers(config: dict, *, json_body: bool = False) -> dict[str, str]:
    headers = api_headers({**config, "authType": "basic", "username": config.get("username"), "password": config.get("password")}, json_body=json_body)
    account = config.get("account")
    if account:
        headers["account"] = str(account)
        headers.setdefault("X-U8-Account", str(account))
    return headers


def yonyou_extract(config: dict, job_cfg: dict) -> list[dict]:
    base = str(config.get("baseUrl") or "")
    path = _entity(job_cfg)
    url = join_url(base, path)
    if not url:
        raise RuntimeError("用友缺少 baseUrl / path")
    extra = query_params(job_cfg)
    if extra:
        url = f"{url}{'&' if '?' in url else '?'}{urlencode(extra)}"
    _, payload = http_request(url, headers=_yonyou_headers(config), timeout=30)
    return filter_rows(parse_records(payload), job_cfg)[: _limit(job_cfg)]


def yonyou_load(config: dict, job_cfg: dict, row: dict) -> None:
    url = join_url(str(config.get("baseUrl") or ""), _entity(job_cfg))
    http_request(
        url,
        method=str(job_cfg.get("method") or "POST"),
        headers=_yonyou_headers(config, json_body=True),
        body=json.dumps(row, ensure_ascii=False, default=str).encode("utf-8"),
        timeout=30,
    )


def _fxiaoke_token(config: dict) -> tuple[str, str]:
    app_id = config.get("appId")
    secret = config.get("appSecret")
    code = config.get("permanentCode") or config.get("permanent_code")
    if not app_id or not secret:
        raise RuntimeError("纷享销客缺少 AppId / AppSecret")
    body: dict[str, Any] = {"appId": app_id, "appSecret": secret}
    if code:
        body["permanentCode"] = code
    _, payload = http_request(
        "https://open.fxiaoke.com/cgi/corpAccessToken/get/V2",
        method="POST",
        headers={"Content-Type": "application/json"},
        body=json.dumps(body).encode("utf-8"),
        timeout=20,
    )
    if not isinstance(payload, dict) or payload.get("errorCode") not in (0, None, "0"):
        raise RuntimeError((payload or {}).get("errorMessage") if isinstance(payload, dict) else "纷享销客 token 失败")
    token = payload.get("corpAccessToken") or payload.get("accessToken")
    corp = payload.get("corpId") or ""
    if not token:
        raise RuntimeError("纷享销客未返回 corpAccessToken")
    return str(token), str(corp)


def fxiaoke_test(config: dict) -> dict:
    try:
        _fxiaoke_token(config)
        return {"success": True, "message": "纷享销客凭证有效"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def fxiaoke_extract(config: dict, job_cfg: dict) -> list[dict]:
    token, corp_id = _fxiaoke_token(config)
    entity = _entity(job_cfg)
    path = entity if "/" in entity else "cgi/user/simpleList"
    url = join_url("https://open.fxiaoke.com", path)
    body = {"corpAccessToken": token, "corpId": corp_id, "currentOpenUserId": config.get("openUserId") or ""}
    body.update(query_params(job_cfg))
    _, payload = http_request(
        url,
        method="POST",
        headers={"Content-Type": "application/json"},
        body=json.dumps(body).encode("utf-8"),
        timeout=20,
    )
    return filter_rows(parse_records(payload, "userList" if isinstance(payload, dict) else ""), job_cfg)[: _limit(job_cfg)]


def fxiaoke_load(config: dict, job_cfg: dict, row: dict) -> None:
    token, corp_id = _fxiaoke_token(config)
    path = _entity(job_cfg)
    if path in ("users", ""):
        raise RuntimeError("纷享销客写入请在 targetConfig.path 填写接口路径")
    url = join_url("https://open.fxiaoke.com", path)
    body = {"corpAccessToken": token, "corpId": corp_id, **row}
    http_request(url, method="POST", headers={"Content-Type": "application/json"}, body=json.dumps(body, default=str).encode("utf-8"), timeout=20)


def scim_headers(config: dict, *, json_body: bool = False) -> dict[str, str]:
    headers = {"Accept": "application/scim+json, application/json"}
    if json_body:
        headers["Content-Type"] = "application/scim+json"
    token = config.get("token") or config.get("bearer")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def scim_test(config: dict) -> dict:
    base = str(config.get("baseUrl") or "")
    if not base:
        return {"success": False, "message": "缺少 SCIM Base URL"}
    try:
        status, _ = http_request(join_url(base, "Users") + "?count=1", headers=scim_headers(config), timeout=15)
        if status >= 400:
            return {"success": False, "message": f"HTTP {status}"}
        return {"success": True, "message": f"SCIM 可达 HTTP {status}"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def scim_extract(config: dict, job_cfg: dict) -> list[dict]:
    base = str(config.get("baseUrl") or "")
    entity = _entity(job_cfg)
    if entity in ("users", "user", ""):
        entity = "Users"
    elif entity in ("groups", "group"):
        entity = "Groups"
    params = {"count": _limit(job_cfg), "startIndex": 1}
    extra = query_params(job_cfg)
    field = extra and next(iter(extra.keys()), "")
    if field:
        params["filter"] = f'{field} gt "{list(extra.values())[0]}"'
    url = join_url(base, entity) + "?" + urlencode(params)
    _, payload = http_request(url, headers=scim_headers(config), timeout=30)
    rows = []
    if isinstance(payload, dict):
        rows = [x for x in (payload.get("Resources") or []) if isinstance(x, dict)]
    return filter_rows(rows, job_cfg)[: _limit(job_cfg)]


def scim_load(config: dict, job_cfg: dict, row: dict, *, operation: str, match_keys: list[str]) -> None:
    base = str(config.get("baseUrl") or "")
    entity = _entity(job_cfg)
    if entity in ("users", "user", ""):
        entity = "Users"
    url = join_url(base, entity)
    if operation == "update" and match_keys and row.get(match_keys[0]):
        url = f"{url.rstrip('/')}/{row[match_keys[0]]}"
        http_request(url, method="PUT", headers=scim_headers(config, json_body=True), body=json.dumps(row, default=str).encode("utf-8"), timeout=30)
        return
    http_request(url, method="POST", headers=scim_headers(config, json_body=True), body=json.dumps(row, default=str).encode("utf-8"), timeout=30)


def inspect_http_like(kind: str, extract_fn, config: dict, job_cfg: dict | None = None) -> dict:
    job_cfg = job_cfg or {}
    try:
        sample = extract_fn(config, {**job_cfg, "batch_size": 20})[:20]
    except Exception as exc:
        return {"dialect": kind, "tables": [], "columns": [], "sample": [], "message": str(exc)}
    columns = [{"name": k, "type": type(v).__name__} for k, v in (sample[0].items() if sample else [])]
    return {"dialect": kind, "tables": [], "columns": columns, "sample": sample}
