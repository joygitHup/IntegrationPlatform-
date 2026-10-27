"""钉钉 / 企微 / AD(LDAP) 通讯录拉取。"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from datasources.config_utils import normalize_type


class IdentityError(RuntimeError):
    pass


def _http_json(url: str, *, method: str = "GET", body: dict | None = None, headers: dict | None = None, timeout: float = 20) -> Any:
    raw = json.dumps(body).encode("utf-8") if body is not None else None
    hdrs = {"Accept": "application/json", **(headers or {})}
    if raw is not None:
        hdrs["Content-Type"] = "application/json"
    req = Request(url, data=raw, headers=hdrs, method=method)
    with urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", "ignore")
    if not text:
        return {}
    return json.loads(text)


def _norm_user(item: dict, *, source: str) -> dict:
    user_id = str(item.get("userid") or item.get("userId") or item.get("id") or item.get("username") or "")
    depts = item.get("department") or item.get("deptIdList") or item.get("departmentIds") or []
    if isinstance(depts, (str, int)):
        depts = [depts]
    return {
        "id": user_id,
        "username": item.get("userid") or item.get("userId") or item.get("sAMAccountName") or item.get("uid") or user_id,
        "name": item.get("name") or item.get("displayName") or item.get("cn") or "",
        "email": item.get("email") or item.get("mail") or "",
        "mobile": item.get("mobile") or item.get("telephoneNumber") or "",
        "title": item.get("title") or item.get("position") or "",
        "departmentIds": [str(x) for x in depts],
        "status": "active" if item.get("active", True) else "disabled",
        "source": source,
        "raw": item,
    }


def _norm_dept(item: dict, *, source: str) -> dict:
    source_id = str(item.get("id") or item.get("deptId") or item.get("departmentId") or item.get("code") or "")
    parent = item.get("parentid") or item.get("parentId") or item.get("parent_id") or ""
    return {
        "sourceId": source_id,
        "code": str(item.get("code") or source_id),
        "name": item.get("name") or item.get("deptName") or "",
        "parentSourceId": "" if parent in (None, 0, "0", "") else str(parent),
        "sortOrder": item.get("order") or item.get("sortOrder") or 0,
        "source": source,
    }


def dingtalk_token(config: dict) -> str:
    """公开：钉钉 access_token，供 ETL 写入（load_identity）和调度器复用。"""
    app_key = config.get("appKey") or config.get("app_key")
    app_secret = config.get("appSecret") or config.get("app_secret")
    if not app_key or not app_secret:
        raise IdentityError("钉钉缺少 AppKey / AppSecret")
    token_data = _http_json(
        "https://oapi.dingtalk.com/gettoken?" + urlencode({"appkey": app_key, "appsecret": app_secret})
    )
    token = token_data.get("access_token")
    if not token:
        raise IdentityError(token_data.get("errmsg") or "钉钉获取 token 失败")
    return str(token)


def wecom_token(config: dict) -> str:
    """公开：企微 access_token，供 ETL 写入和调度器复用。"""
    corp_id = config.get("corpId") or config.get("corpid")
    secret = config.get("secret")
    if not corp_id or not secret:
        raise IdentityError("企微缺少 CorpId / Secret")
    token_data = _http_json(
        "https://qyapi.weixin.qq.com/cgi-bin/gettoken?" + urlencode({"corpid": corp_id, "corpsecret": secret})
    )
    token = token_data.get("access_token")
    if not token:
        raise IdentityError(token_data.get("errmsg") or "企微获取 token 失败")
    return str(token)


def pull_dingtalk(config: dict) -> dict:
    token = dingtalk_token(config)
    dept_data = _http_json("https://oapi.dingtalk.com/department/list?" + urlencode({"access_token": token}))
    if dept_data.get("errcode") not in (0, None):
        raise IdentityError(dept_data.get("errmsg") or "钉钉部门拉取失败")
    departments = [_norm_dept(d, source="dingtalk") for d in (dept_data.get("department") or [])]
    # P1-1 优化：钉钉 v2 API 支持不传 dept_id 全量拉（size=100，offset 分页），
    # 旧版按部门串行拉在部门数多时触发 429 限流且耗时 O(N_dept * N_user_per_dept)。
    # fallback：如果 v2 接口不支持（老企业），再回退按部门逐拉。
    users: list[dict] = []
    try:
        offset = 0
        v2_ok = True
        page_count = 0
        while True:
            page = _http_json(
                "https://oapi.dingtalk.com/topapi/v2/user/list?"
                + urlencode({"access_token": token, "offset": offset, "size": 100})
            )
            if page.get("errcode") not in (0, None):
                v2_ok = False
                break
            result = page.get("result") or {}
            batch = result.get("list") or []
            users.extend(_norm_user(u, source="dingtalk") for u in batch)
            page_count += 1
            logger.info("钉钉 v2 全量拉取进度 page=%d batch=%d total=%d", page_count, len(batch), len(users))
            if not result.get("has_more"):
                break
            offset += 100
        if v2_ok and users:
            logger.info("钉钉 v2 拉取完成，总计 %d 用户 / %d 部门，用时 %d 页",
                        len(users), len(departments), page_count)
            return {"source": "dingtalk", "users": _dedupe_users(users), "departments": departments}
    except Exception:
        logger.info("钉钉 v2 拉取不可用，回退按部门逐拉")
    # fallback：按部门逐拉（老企业 / v2 权限未开）
    dept_ids = [d["sourceId"] for d in departments] or ["1"]
    for idx, dept_id in enumerate(dept_ids, 1):
        offset = 0
        while True:
            page = _http_json(
                "https://oapi.dingtalk.com/user/listbypage?"
                + urlencode({"access_token": token, "department_id": dept_id, "offset": offset, "size": 100})
            )
            if page.get("errcode") not in (0, None):
                break
            batch = page.get("userlist") or []
            users.extend(_norm_user(u, source="dingtalk") for u in batch)
            if not page.get("hasMore"):
                break
            offset += 100
        if idx % 50 == 0:
            logger.info("钉钉 fallback 拉取进度 dept=%d/%d users=%d", idx, len(dept_ids), len(users))
    logger.info("钉钉 fallback 拉取完成，总计 %d 用户 / %d 部门", len(users), len(departments))
    return {"source": "dingtalk", "users": _dedupe_users(users), "departments": departments}


def pull_wecom(config: dict) -> dict:
    corp_id = config.get("corpId") or config.get("corpid")
    secret = config.get("secret")
    if not corp_id or not secret:
        raise IdentityError("企微缺少 CorpId / Secret")
    token_data = _http_json(
        "https://qyapi.weixin.qq.com/cgi-bin/gettoken?" + urlencode({"corpid": corp_id, "corpsecret": secret})
    )
    token = token_data.get("access_token")
    if not token:
        raise IdentityError(token_data.get("errmsg") or "企微获取 token 失败")
    dept_data = _http_json(
        "https://qyapi.weixin.qq.com/cgi-bin/department/list?" + urlencode({"access_token": token})
    )
    if dept_data.get("errcode") not in (0, None):
        raise IdentityError(dept_data.get("errmsg") or "企微部门拉取失败")
    departments = [_norm_dept(d, source="wecom") for d in (dept_data.get("department") or [])]
    users = []
    root = departments[0]["sourceId"] if departments else "1"
    page = _http_json(
        "https://qyapi.weixin.qq.com/cgi-bin/user/list?"
        + urlencode({"access_token": token, "department_id": root, "fetch_child": 1})
    )
    if page.get("errcode") not in (0, None):
        raise IdentityError(page.get("errmsg") or "企微用户拉取失败")
    users = [_norm_user(u, source="wecom") for u in (page.get("userlist") or [])]
    return {"source": "wecom", "users": users, "departments": departments}


def pull_ldap(config: dict, *, kind: str = "ldap") -> dict:
    try:
        from ldap3 import ALL, SUBTREE, Connection, Server
    except ImportError as exc:
        raise IdentityError("未安装 ldap3，无法连接 AD/LDAP。请 pip install ldap3") from exc
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
    base = str(config.get("baseDn") or "")
    user_filter = str(config.get("userFilter") or "(|(objectClass=user)(objectClass=person)(objectClass=inetOrgPerson))")
    conn.search(
        base, user_filter, search_scope=SUBTREE,
        attributes=["cn", "displayName", "mail", "sAMAccountName", "uid", "telephoneNumber", "title", "department", "distinguishedName"],
    )
    users = []
    for entry in conn.entries:
        attrs = json.loads(entry.entry_to_json()).get("attributes") or {}
        flat = {k: (v[0] if isinstance(v, list) and v else v) for k, v in attrs.items()}
        username = flat.get("sAMAccountName") or flat.get("uid") or flat.get("cn") or ""
        users.append(_norm_user({
            "id": username or flat.get("distinguishedName"),
            "username": username,
            "displayName": flat.get("displayName") or flat.get("cn"),
            "mail": flat.get("mail"),
            "telephoneNumber": flat.get("telephoneNumber"),
            "title": flat.get("title"),
            "department": [flat["department"]] if flat.get("department") else [],
        }, source=kind))
    dept_filter = str(config.get("deptFilter") or "(|(objectClass=organizationalUnit)(objectClass=container))")
    conn.search(base, dept_filter, search_scope=SUBTREE, attributes=["ou", "cn", "distinguishedName"])
    departments = []
    for entry in conn.entries:
        attrs = json.loads(entry.entry_to_json()).get("attributes") or {}
        flat = {k: (v[0] if isinstance(v, list) and v else v) for k, v in attrs.items()}
        dn = str(flat.get("distinguishedName") or entry.entry_dn)
        name = flat.get("ou") or flat.get("cn") or dn
        departments.append(_norm_dept({"id": dn, "name": name, "code": name}, source=kind))
    conn.unbind()
    return {"source": kind, "users": users, "departments": departments}


def _dedupe_users(users: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    order: list[str] = []
    for u in users:
        key = str(u.get("id") or u.get("username") or "")
        if not key:
            continue
        if key not in seen:
            seen[key] = u
            order.append(key)
            continue
        old = seen[key]
        merged = list(dict.fromkeys((old.get("departmentIds") or []) + (u.get("departmentIds") or [])))
        old["departmentIds"] = merged
    return [seen[k] for k in order]


def pull_identity(ds_type: str, config: dict) -> dict:
    kind = normalize_type(ds_type)
    if kind == "dingtalk":
        return pull_dingtalk(config)
    if kind == "wecom":
        return pull_wecom(config)
    if kind in ("ldap", "active_directory"):
        return pull_ldap(config, kind=kind)
    raise IdentityError(f"不支持的身份源: {ds_type}，当前支持 dingtalk / wecom / ldap / active_directory")


def ping_identity(ds_type: str, config: dict) -> dict:
    kind = normalize_type(ds_type)
    try:
        if kind == "dingtalk":
            data = _http_json(
                "https://oapi.dingtalk.com/gettoken?"
                + urlencode({"appkey": config.get("appKey") or "", "appsecret": config.get("appSecret") or ""})
            )
            if not data.get("access_token"):
                return {"success": False, "message": data.get("errmsg") or "钉钉 token 失败"}
            return {"success": True, "message": "钉钉凭证有效"}
        if kind == "wecom":
            data = _http_json(
                "https://qyapi.weixin.qq.com/cgi-bin/gettoken?"
                + urlencode({"corpid": config.get("corpId") or "", "corpsecret": config.get("secret") or ""})
            )
            if not data.get("access_token"):
                return {"success": False, "message": data.get("errmsg") or "企微 token 失败"}
            return {"success": True, "message": "企微凭证有效"}
        if kind in ("ldap", "active_directory"):
            pull_ldap(config, kind=kind)
            return {"success": True, "message": "目录服务连接成功"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}
    return {"success": False, "message": f"不支持的身份源: {ds_type}"}
