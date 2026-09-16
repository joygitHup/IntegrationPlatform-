"""MongoDB / Elasticsearch 真实 Extract / Load / 探测。"""
from __future__ import annotations

from typing import Any

from datasources.connectors.http_runtime import http_request, parse_records


class DriverMissing(RuntimeError):
    pass


def _name(job_cfg: dict, *keys: str, default: str = "") -> str:
    for key in keys:
        value = job_cfg.get(key)
        if value not in (None, ""):
            return str(value)
    return default


def _limit(job_cfg: dict) -> int:
    try:
        return max(1, min(int(job_cfg.get("batch_size") or 1000), 100000))
    except (TypeError, ValueError):
        return 1000


def mongo_connect(config: dict):
    try:
        from pymongo import MongoClient
    except ImportError as exc:
        raise DriverMissing("未安装 pymongo，无法连接 MongoDB。请 pip install pymongo") from exc
    uri = str(config.get("uri") or config.get("url") or "")
    if uri:
        client = MongoClient(uri, serverSelectionTimeoutMS=int(config.get("connectTimeout") or 10) * 1000)
    else:
        client = MongoClient(
            host=str(config.get("host") or "127.0.0.1"),
            port=int(config.get("port") or 27017),
            username=str(config.get("user") or config.get("username") or "") or None,
            password=str(config.get("password") or "") or None,
            serverSelectionTimeoutMS=int(config.get("connectTimeout") or 10) * 1000,
        )
    db_name = str(config.get("database") or config.get("db") or "")
    if not db_name:
        raise RuntimeError("MongoDB 缺少 database")
    return client, client[db_name]


def mongo_test(config: dict) -> dict:
    try:
        client, db = mongo_connect(config)
        db.command("ping")
        client.close()
        return {"success": True, "message": "MongoDB 连接成功"}
    except DriverMissing as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        return {"success": False, "message": f"连接失败: {exc}"}


def mongo_extract(config: dict, job_cfg: dict) -> list[dict]:
    _client, db = mongo_connect(config)
    try:
        coll_name = _name(job_cfg, "table", "path", "collection") or str(config.get("collection") or "")
        if not coll_name:
            raise RuntimeError("请在任务源配置中填写集合名（sourceConfig.table）")
        query: dict[str, Any] = {}
        field = (job_cfg.get("watermark_field") or "").strip()
        value = job_cfg.get("watermark_value") or ""
        if job_cfg.get("sync_mode") == "incremental" and field and value not in (None, ""):
            query[field] = {"$gt": value}
        cursor = db[coll_name].find(query).limit(_limit(job_cfg))
        rows = []
        for doc in cursor:
            item = dict(doc)
            if "_id" in item:
                item["_id"] = str(item["_id"])
            rows.append(item)
        return rows
    finally:
        _client.close()


def mongo_load(config: dict, job_cfg: dict, row: dict, *, operation: str, match_keys: list[str]) -> None:
    _client, db = mongo_connect(config)
    try:
        coll_name = _name(job_cfg, "table", "path", "collection") or str(config.get("collection") or "")
        if not coll_name:
            raise RuntimeError("请在任务目标配置中填写集合名")
        payload = dict(row)
        payload.pop("_id", None)
        coll = db[coll_name]
        if operation == "update" and match_keys:
            filt = {k: row[k] for k in match_keys if k in row}
            if filt:
                coll.update_one(filt, {"$set": payload}, upsert=False)
                return
        coll.insert_one(payload)
    finally:
        _client.close()


def mongo_inspect(config: dict, job_cfg: dict | None = None) -> dict:
    job_cfg = job_cfg or {}
    _client, db = mongo_connect(config)
    try:
        names = db.list_collection_names()
        tables = [{"name": n} for n in names]
        sample: list[dict] = []
        columns: list[dict] = []
        coll_name = _name(job_cfg, "table", "path", "collection")
        if coll_name:
            sample = mongo_extract(config, {**job_cfg, "table": coll_name, "sync_mode": "full", "batch_size": 20})[:20]
            if sample:
                columns = [{"name": k, "type": type(v).__name__} for k, v in sample[0].items()]
        return {"dialect": "mongodb", "tables": tables[:200], "columns": columns, "sample": sample}
    finally:
        _client.close()


def _es_base(config: dict) -> str:
    host = str(config.get("host") or "127.0.0.1").rstrip("/")
    if host.startswith("http://") or host.startswith("https://"):
        base = host
    else:
        port = int(config.get("port") or 9200)
        base = f"http://{host}:{port}"
    return base.rstrip("/")


def _es_headers(config: dict) -> dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    user = config.get("username") or config.get("user") or ""
    password = config.get("password") or ""
    if user:
        import base64

        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {token}"
    return headers


def es_test(config: dict) -> dict:
    try:
        status, payload = http_request(
            _es_base(config) + "/_cluster/health",
            headers=_es_headers(config),
            timeout=float(config.get("connectTimeout") or 10),
        )
        if status >= 400:
            return {"success": False, "message": f"Elasticsearch HTTP {status}"}
        name = payload.get("cluster_name") if isinstance(payload, dict) else ""
        return {"success": True, "message": f"Elasticsearch 连接成功 {name}".strip()}
    except Exception as exc:
        return {"success": False, "message": str(exc)}


def es_extract(config: dict, job_cfg: dict) -> list[dict]:
    index = _name(job_cfg, "table", "path", "index") or str(config.get("index") or "")
    if not index:
        raise RuntimeError("请在任务源配置中填写索引名（sourceConfig.table）")
    body: dict[str, Any] = {"size": _limit(job_cfg), "query": {"match_all": {}}}
    field = (job_cfg.get("watermark_field") or "").strip()
    value = job_cfg.get("watermark_value") or ""
    if job_cfg.get("sync_mode") == "incremental" and field and value not in (None, ""):
        body["query"] = {"range": {field: {"gt": value}}}
        body["sort"] = [{field: "asc"}]
    import json as _json

    _, payload = http_request(
        f"{_es_base(config)}/{index}/_search",
        method="POST",
        headers=_es_headers(config),
        body=_json.dumps(body).encode("utf-8"),
        timeout=30,
    )
    hits = []
    if isinstance(payload, dict):
        hits = ((payload.get("hits") or {}).get("hits") or [])
    rows = []
    for hit in hits:
        src = hit.get("_source") if isinstance(hit, dict) else None
        if isinstance(src, dict):
            row = dict(src)
            row.setdefault("_id", hit.get("_id"))
            rows.append(row)
    return rows


def es_load(config: dict, job_cfg: dict, row: dict, *, operation: str, match_keys: list[str]) -> None:
    import json as _json

    index = _name(job_cfg, "table", "path", "index") or str(config.get("index") or "")
    if not index:
        raise RuntimeError("请在任务目标配置中填写索引名")
    doc_id = ""
    if match_keys and row.get(match_keys[0]) not in (None, ""):
        doc_id = str(row[match_keys[0]])
    elif row.get("_id"):
        doc_id = str(row["_id"])
    payload = {k: v for k, v in row.items() if k != "_id"}
    if operation == "update" and doc_id:
        url = f"{_es_base(config)}/{index}/_update/{doc_id}"
        body = _json.dumps({"doc": payload, "doc_as_upsert": True}).encode("utf-8")
    elif doc_id:
        url = f"{_es_base(config)}/{index}/_doc/{doc_id}"
        body = _json.dumps(payload).encode("utf-8")
    else:
        url = f"{_es_base(config)}/{index}/_doc"
        body = _json.dumps(payload).encode("utf-8")
    http_request(url, method="POST" if "/_update/" in url or url.endswith("/_doc") else "PUT", headers=_es_headers(config), body=body, timeout=30)


def es_inspect(config: dict, job_cfg: dict | None = None) -> dict:
    job_cfg = job_cfg or {}
    _, payload = http_request(f"{_es_base(config)}/_cat/indices?format=json", headers=_es_headers(config), timeout=15)
    tables = []
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict):
                tables.append({"name": item.get("index")})
    index = _name(job_cfg, "table", "path", "index")
    sample: list[dict] = []
    columns: list[dict] = []
    if index:
        sample = es_extract(config, {**job_cfg, "table": index, "sync_mode": "full", "batch_size": 20})[:20]
        if sample:
            columns = [{"name": k, "type": type(v).__name__} for k, v in sample[0].items()]
    return {"dialect": "elasticsearch", "tables": tables[:200], "columns": columns, "sample": sample}
