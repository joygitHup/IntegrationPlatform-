"""飞书 / 用友 / 纷享销客 / SCIM，以及钉钉/企微/AD 作为 ETL 源 + 写入目标（P0 双向同步）。"""
from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import urlencode

from datasources.connectors.http_runtime import api_headers, http_request, join_url, parse_records
from datasources.connectors.watermark import filter_rows, query_params
from org_sync.identity import (
    IdentityError,
    dingtalk_token,
    pull_identity,
    wecom_token,
)

logger = logging.getLogger(__name__)


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


# ---------------------------------------------------------------------------
# P0 双向同步写入：钉钉 / 企微 / LDAP(AD) 作为目标端
# ---------------------------------------------------------------------------

def load_identity(
    kind: str,
    config: dict,
    job_cfg: dict,
    row: dict,
    *,
    operation: str,
    match_keys: list[str],
) -> None:
    """写入身份源通讯录。

    通用 row 字段（ETL transform 后的最终字段名）：
      - username / id / userId : 唯一标识（钉钉 userid、企微 userid、LDAP sAMAccountName）
      - name / display_name : 显示名
      - email : 邮箱
      - mobile : 手机号
      - title / position : 岗位
      - departmentIds / department / deptIds : 所属部门（数组，钉钉/企微接受 dept_id 数组）
    operation: create / update / delete（delete 默认软禁用，config.allowHardDelete=true 时真删）
    """
    if kind == "dingtalk":
        _dingtalk_load(config, row, operation)
        return
    if kind == "wecom":
        _wecom_load(config, row, operation)
        return
    if kind in ("ldap", "active_directory"):
        _ldap_load(kind, config, row, operation)
        return
    raise RuntimeError(f"load_identity 尚未支持 {kind}")


def _api_err(msg: str, payload: Any = None) -> None:
    """把 SaaS API 的 errcode/errcode 转换为 RuntimeError。"""
    if isinstance(payload, dict):
        err = payload.get("errmsg") or payload.get("msg") or payload.get("message") or msg
        code = payload.get("errcode") or payload.get("errcode") or payload.get("code")
        raise RuntimeError(f"{msg}: errcode={code}, msg={err}")
    raise RuntimeError(msg)


def _dingtalk_load(config: dict, row: dict, operation: str) -> None:
    token = dingtalk_token(config)
    base = "https://oapi.dingtalk.com/topapi/v2"
    userid = str(row.get("userid") or row.get("username") or row.get("id") or row.get("userId") or "")
    mobile = str(row.get("mobile") or "")
    if not userid and operation in ("update", "delete"):
        # update/delete 必须知道谁，mobile 查一下 userid
        if mobile:
            _, payload = http_request(
                f"{base}/user/getbymobile?" + urlencode({"access_token": token, "mobile": mobile}),
                timeout=15,
            )
            if isinstance(payload, dict) and payload.get("errcode") == 0:
                userid = str((payload.get("result") or {}).get("userid") or "")
    if not userid:
        if operation == "create":
            if not mobile:
                raise RuntimeError("钉钉创建用户需要 userid 或 mobile")
        else:
            raise RuntimeError(
                f"钉钉 {operation} 用户失败：缺少 userid 或 mobile（反查也未命中）"
            )

    if operation == "delete":
        # 默认软禁用；配置 allowHardDelete=true 时真删
        if str(config.get("allowHardDelete") or "").lower() in ("true", "1", "yes"):
            _, payload = http_request(
                f"{base}/user/delete",
                method="POST",
                headers={"Content-Type": "application/json"},
                body=json.dumps({"access_token": token, "userid": userid}).encode("utf-8"),
                timeout=15,
            )
            if isinstance(payload, dict) and payload.get("errcode") not in (0, None):
                _api_err("钉钉删除用户失败", payload)
            logger.info("钉钉用户已删除 userid=%s", userid)
        else:
            _, payload = http_request(
                f"{base}/user/update",
                method="POST",
                headers={"Content-Type": "application/json"},
                body=json.dumps({"access_token": token, "userid": userid, "active": False}).encode("utf-8"),
                timeout=15,
            )
            if isinstance(payload, dict) and payload.get("errcode") not in (0, None):
                _api_err("钉钉禁用用户失败", payload)
            logger.info("钉钉用户已禁用 userid=%s", userid)
        return

    # 构造钉钉 API payload（通用 row → 钉钉字段）
    dept_ids = row.get("departmentIds") or row.get("department") or row.get("deptIds") or []
    if isinstance(dept_ids, (str, int)):
        dept_ids = [dept_ids]
    dept_ids = [int(x) for x in dept_ids if str(x).isdigit()]
    body = {
        "access_token": token,
        "userid": userid,
    }
    for k, v in (
        ("name", row.get("name") or row.get("display_name")),
        ("mobile", mobile or None),
        ("email", row.get("email") or None),
        ("title", row.get("title") or row.get("position") or None),
        ("dept_id_list", dept_ids or None),
    ):
        if v not in (None, "", [], {}):
            body[k] = v

    if operation == "create":
        _, payload = http_request(
            f"{base}/user/create",
            method="POST",
            headers={"Content-Type": "application/json"},
            body=json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"),
            timeout=20,
        )
        if isinstance(payload, dict) and payload.get("errcode") not in (0, None):
            _api_err("钉钉创建用户失败", payload)
        logger.info("钉钉用户已创建 userid=%s", userid)
    else:
        _, payload = http_request(
            f"{base}/user/update",
            method="POST",
            headers={"Content-Type": "application/json"},
            body=json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"),
            timeout=20,
        )
        if isinstance(payload, dict) and payload.get("errcode") not in (0, None):
            _api_err("钉钉更新用户失败", payload)
        logger.info("钉钉用户已更新 userid=%s", userid)


def _wecom_load(config: dict, row: dict, operation: str) -> None:
    token = wecom_token(config)
    base = "https://qyapi.weixin.qq.com/cgi-bin"
    userid = str(row.get("userid") or row.get("username") or row.get("id") or row.get("userId") or "")
    mobile = str(row.get("mobile") or "")
    if not userid and operation in ("update", "delete") and mobile:
        _, payload = http_request(
            f"{base}/user/get_user_id?" + urlencode({"access_token": token, "mobile": mobile}),
            timeout=15,
        )
        if isinstance(payload, dict) and payload.get("errcode") == 0:
            userid = str(payload.get("userid") or "")
    if not userid:
        raise RuntimeError(
            f"企微 {operation} 用户失败：缺少 userid（或 mobile 用于反查）"
        )

    if operation == "delete":
        if str(config.get("allowHardDelete") or "").lower() in ("true", "1", "yes"):
            _, payload = http_request(
                f"{base}/user/delete?" + urlencode({"access_token": token, "userid": userid}),
                timeout=15,
            )
            if isinstance(payload, dict) and payload.get("errcode") not in (0, None):
                _api_err("企微删除用户失败", payload)
        else:
            _, payload = http_request(
                f"{base}/user/update",
                method="POST",
                headers={"Content-Type": "application/json"},
                body=json.dumps({"access_token": token, "userid": userid, "enable": 0}).encode("utf-8"),
                timeout=15,
            )
            if isinstance(payload, dict) and payload.get("errcode") not in (0, None):
                _api_err("企微禁用用户失败", payload)
        logger.info("企微用户已%s userid=%s", "删除" if operation == "delete" and str(config.get("allowHardDelete") or "").lower() in ("true", "1", "yes") else "禁用", userid)
        return

    dept_ids = row.get("departmentIds") or row.get("department") or row.get("deptIds") or []
    if isinstance(dept_ids, (str, int)):
        dept_ids = [dept_ids]
    dept_ids = [int(x) for x in dept_ids if str(x).isdigit()]
    body = {
        "access_token": token,
        "userid": userid,
    }
    for k, v in (
        ("name", row.get("name") or row.get("display_name")),
        ("mobile", mobile or None),
        ("email", row.get("email") or None),
        ("position", row.get("title") or row.get("position") or None),
        ("department", dept_ids or None),
    ):
        if v not in (None, "", [], {}):
            body[k] = v

    endpoint = f"{base}/user/{'create' if operation == 'create' else 'update'}"
    _, payload = http_request(
        endpoint,
        method="POST",
        headers={"Content-Type": "application/json"},
        body=json.dumps(body, ensure_ascii=False, default=str).encode("utf-8"),
        timeout=20,
    )
    if isinstance(payload, dict) and payload.get("errcode") not in (0, None):
        _api_err(f"企微{'创建' if operation == 'create' else '更新'}用户失败", payload)
    logger.info("企微用户已%s userid=%s", "创建" if operation == "create" else "更新", userid)


def _ldap_load(kind: str, config: dict, row: dict, operation: str) -> None:
    try:
        from ldap3 import ALL, SUBTREE, Connection, ModifyOp, Server
    except ImportError as exc:
        raise RuntimeError("未安装 ldap3，无法写入 AD/LDAP。请 pip install ldap3") from exc
    host = config.get("host") or config.get("url") or ""
    port = int(config.get("port") or (636 if str(host).startswith("ldaps") else 389))
    url = str(config.get("url") or "")
    if url.startswith("ldap"):
        server = Server(url, get_info=ALL)
    else:
        server = Server(str(host), port=port, get_info=ALL)
    conn = Connection(
        server,
        user=str(config.get("bindDn") or ""),
        password=str(config.get("bindPassword") or ""),
        auto_bind=True,
    )
    try:
        username = str(row.get("username") or row.get("id") or row.get("userId") or "")
        base = str(config.get("baseDn") or "")
        if not username or not base:
            raise RuntimeError("LDAP 写入需要 username 和 baseDn")
        conn.search(
            base,
            f"(sAMAccountName={username})" if kind == "active_directory" else f"(uid={username})",
            search_scope=SUBTREE,
        )
        existing = list(conn.entries)
        if operation == "create":
            if existing:
                logger.warning("LDAP 用户已存在 %s，跳过 create", username)
                return
            cn = row.get("name") or row.get("display_name") or username
            attrs = {
                "objectClass": ["top", "person", "organizationalPerson", "user"] if kind == "active_directory" else ["top", "person", "organizationalPerson", "inetOrgPerson"],
                "cn": cn,
                "sAMAccountName": username,
                "displayName": cn,
                "mail": row.get("email") or "",
                "telephoneNumber": row.get("mobile") or "",
                "title": row.get("title") or row.get("position") or "",
            }
            attrs = {k: [v] if isinstance(v, str) else v for k, v in attrs.items() if v}
            dn = f"CN={cn},{base}" if kind == "active_directory" else f"uid={username},{base}"
            conn.add(dn, attributes=attrs)
            logger.info("LDAP 用户已创建 %s", username)
        elif operation == "update":
            if not existing:
                raise RuntimeError(f"LDAP 用户不存在: {username}")
            dn = str(existing[0].entry_dn)
            changes: list[tuple] = []
            mapping = {
                "displayName": row.get("name") or row.get("display_name"),
                "mail": row.get("email"),
                "telephoneNumber": row.get("mobile"),
                "title": row.get("title") or row.get("position"),
            }
            for attr, val in mapping.items():
                if val not in (None, ""):
                    changes.append((attr, ModifyOp.REPLACE, [val]))
            if changes:
                conn.modify(dn, changes)
                logger.info("LDAP 用户已更新 %s", username)
        elif operation == "delete":
            if not existing:
                return
            dn = str(existing[0].entry_dn)
            conn.delete(dn)
            logger.info("LDAP 用户已删除 %s", username)
    finally:
        conn.unbind()
