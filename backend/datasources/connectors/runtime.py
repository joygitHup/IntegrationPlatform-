"""连接器运行时：按类型分发 Extract / Load / 探测。"""
from __future__ import annotations

from datasources.config_utils import normalize_type
from datasources.connectors import document_runtime, file_runtime, http_runtime, saas_runtime, sql_runtime

SQL_TYPES = {"mysql", "postgresql", "postgres", "oracle", "sqlserver", "dameng", "kingbase"}
HTTP_TYPES = {"http_api", "webhook"}
MQ_TYPES = {"kafka", "rabbitmq", "rocketmq", "redis"}
DOC_TYPES = {"mongodb", "elasticsearch"}
FILE_TYPES = {"sftp", "ftp", "s3", "csv_excel"}
IDENTITY_TYPES = {"dingtalk", "wecom", "ldap", "active_directory"}
SAAS_HTTP_TYPES = {"feishu", "yonyou_u8", "fenxiangxiaoke", "scim2"}
SUPPORTED_EXTRACT = SQL_TYPES | HTTP_TYPES | MQ_TYPES | DOC_TYPES | FILE_TYPES | IDENTITY_TYPES | SAAS_HTTP_TYPES
SUPPORTED_LOAD = SQL_TYPES | HTTP_TYPES | MQ_TYPES | DOC_TYPES | FILE_TYPES | SAAS_HTTP_TYPES | IDENTITY_TYPES


def _kind(ds_type: str) -> str:
    return normalize_type(ds_type)


def sql_dialect(ds_type: str) -> str:
    return sql_runtime.dialect_of(_kind(ds_type))


def try_test(ds_type: str, config: dict) -> dict | None:
    kind = _kind(ds_type)
    if kind in SQL_TYPES:
        return sql_runtime.test(sql_dialect(kind), config)
    if kind in HTTP_TYPES:
        return http_runtime.test(config)
    if kind in IDENTITY_TYPES:
        from org_sync.identity import ping_identity

        return ping_identity(kind, config)
    if kind in MQ_TYPES:
        from datasources.connectors import mq_runtime

        return mq_runtime.test(kind, config)
    if kind == "mongodb":
        return document_runtime.mongo_test(config)
    if kind == "elasticsearch":
        return document_runtime.es_test(config)
    if kind == "sftp":
        return file_runtime.sftp_test(config)
    if kind == "ftp":
        return file_runtime.ftp_test(config)
    if kind == "s3":
        return file_runtime.s3_test(config)
    if kind == "csv_excel":
        return file_runtime.csv_test(config)
    if kind == "feishu":
        return saas_runtime.feishu_test(config)
    if kind == "yonyou_u8":
        return saas_runtime.yonyou_test(config)
    if kind == "fenxiangxiaoke":
        return saas_runtime.fxiaoke_test(config)
    if kind == "scim2":
        return saas_runtime.scim_test(config)
    return None


def extract_records(ds_type: str, config: dict, job_cfg: dict) -> list[dict]:
    kind = _kind(ds_type)
    if kind in SQL_TYPES:
        return sql_runtime.extract(sql_dialect(kind), config, job_cfg)
    if kind in HTTP_TYPES:
        cfg = dict(config)
        if kind == "webhook":
            cfg.setdefault("baseUrl", cfg.get("url") or "")
            if not job_cfg.get("method"):
                cfg["method"] = "GET"
        return http_runtime.extract(cfg, job_cfg)
    if kind in MQ_TYPES:
        from datasources.connectors import mq_runtime

        return mq_runtime.extract(kind, config, job_cfg)
    if kind == "mongodb":
        return document_runtime.mongo_extract(config, job_cfg)
    if kind == "elasticsearch":
        return document_runtime.es_extract(config, job_cfg)
    if kind == "sftp":
        return file_runtime.sftp_extract(config, job_cfg)
    if kind == "ftp":
        return file_runtime.ftp_extract(config, job_cfg)
    if kind == "s3":
        return file_runtime.s3_extract(config, job_cfg)
    if kind == "csv_excel":
        return file_runtime.csv_extract(config, job_cfg)
    if kind in IDENTITY_TYPES:
        return saas_runtime.extract_identity(kind, config, job_cfg)
    if kind == "feishu":
        return saas_runtime.feishu_extract(config, job_cfg)
    if kind == "yonyou_u8":
        return saas_runtime.yonyou_extract(config, job_cfg)
    if kind == "fenxiangxiaoke":
        return saas_runtime.fxiaoke_extract(config, job_cfg)
    if kind == "scim2":
        return saas_runtime.scim_extract(config, job_cfg)
    raise RuntimeError(f"连接器 {ds_type} 尚未实现真实读取")


def lookup_existing(ds_type: str, config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> dict | None:
    kind = _kind(ds_type)
    if not match_keys:
        return None
    if kind in SQL_TYPES:
        return sql_runtime.lookup(sql_dialect(kind), config, job_cfg, row, match_keys)
    if kind == "mongodb":
        from datasources.connectors.document_runtime import mongo_connect, _name

        client, db = mongo_connect(config)
        try:
            coll = _name(job_cfg, "table", "path", "collection")
            filt = {k: row[k] for k in match_keys if k in row}
            found = db[coll].find_one(filt) if coll and filt else None
            if not found:
                return None
            found = dict(found)
            found["_id"] = str(found.get("_id"))
            return found
        finally:
            client.close()
    if kind in HTTP_TYPES:
        cfg = dict(config)
        if kind == "webhook":
            cfg.setdefault("baseUrl", cfg.get("url") or "")
            if not job_cfg.get("method"):
                cfg["method"] = "GET"
        key = http_runtime._record_key(row, match_keys)
        return http_runtime.fetch_existing_map(cfg, job_cfg, match_keys).get(key)
    if kind == "elasticsearch":
        from datasources.connectors.document_runtime import _es_base, _es_headers, _name
        from datasources.connectors.http_runtime import http_request

        index = _name(job_cfg, "table", "path", "index") or str(config.get("index") or "")
        doc_id = str(row.get(match_keys[0], "") if match_keys else row.get("_id") or "")
        if not index or not doc_id:
            return None
        try:
            _, payload = http_request(
                f"{_es_base(config)}/{index}/_doc/{doc_id}",
                headers=_es_headers(config),
                timeout=15,
            )
        except Exception:
            return None
        if isinstance(payload, dict) and payload.get("found"):
            src = payload.get("_source") or {}
            if isinstance(src, dict):
                src = dict(src)
                src["_id"] = payload.get("_id") or doc_id
                return src
        return None
    if kind == "scim2":
        from datasources.connectors.http_runtime import http_request, join_url
        from datasources.connectors.saas_runtime import _entity, scim_headers

        entity = _entity(job_cfg)
        if entity.lower() in ("users", "user", ""):
            entity = "Users"
        doc_id = str(row.get(match_keys[0], "")) if match_keys else ""
        if not doc_id:
            return None
        try:
            _, payload = http_request(
                join_url(str(config.get("baseUrl") or ""), f"{entity}/{doc_id}"),
                headers=scim_headers(config),
                timeout=15,
            )
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None
    if kind in FILE_TYPES or kind in SAAS_HTTP_TYPES or kind in IDENTITY_TYPES:
        try:
            rows = extract_records(ds_type, config, {**job_cfg, "sync_mode": "full", "batch_size": 500})
        except Exception:
            return None
        want = {k: str(row.get(k, "")) for k in match_keys}
        for rec in rows:
            if all(str(rec.get(k, "")) == want[k] for k in match_keys):
                return rec
        return None
    if kind in MQ_TYPES:
        from datasources.connectors import mq_runtime

        return mq_runtime.lookup(kind, config, {**job_cfg, "match_keys": match_keys}, row, match_keys)
    return None


def http_existing_map(config: dict, job_cfg: dict, match_keys: list[str]) -> dict[str, dict]:
    return http_runtime.fetch_existing_map(config, job_cfg, match_keys)


def load_record(
    ds_type: str,
    config: dict,
    job_cfg: dict,
    row: dict,
    *,
    operation: str,
    match_keys: list[str],
) -> None:
    kind = _kind(ds_type)
    if kind in SQL_TYPES:
        dialect = sql_dialect(kind)
        if operation == "delete":
            sql_runtime.delete_row(dialect, config, job_cfg, row, match_keys)
        elif operation == "update":
            sql_runtime.update_row(dialect, config, job_cfg, row, match_keys)
        else:
            sql_runtime.insert_row(dialect, config, job_cfg, row)
        return
    if kind in HTTP_TYPES:
        method = None
        url = None
        from urllib.parse import quote

        base = http_runtime.join_url(
            str(config.get("baseUrl") or config.get("url") or ""),
            str(job_cfg.get("path") or job_cfg.get("table") or ""),
        )
        if operation == "delete":
            # RESTful DELETE：把 match_key 拼到路径尾
            method = "DELETE"
            if match_keys and row.get(match_keys[0]) not in (None, ""):
                url = f"{base.rstrip('/')}/{quote(str(row.get(match_keys[0])), safe='')}"
        elif operation == "update":
            method = "PUT"
            if match_keys and row.get(match_keys[0]) not in (None, ""):
                url = f"{base.rstrip('/')}/{quote(str(row.get(match_keys[0])), safe='')}"
        http_runtime.load_row(config, job_cfg, row, method=method, url=url)
        return
    if kind in MQ_TYPES:
        from datasources.connectors import mq_runtime

        # MQ 模式 delete 语义合理：publish 一条带 op="delete" 的消息通知下游
        mq_runtime.load(kind, config, {**job_cfg, "match_keys": match_keys, "operation": operation}, row)
        return
    if kind == "mongodb":
        document_runtime.mongo_load(config, job_cfg, row, operation=operation, match_keys=match_keys)
        return
    if kind == "elasticsearch":
        document_runtime.es_load(config, job_cfg, row, operation=operation, match_keys=match_keys)
        return
    if kind in FILE_TYPES:
        if operation == "delete":
            import logging

            logging.getLogger(__name__).warning(
                "文件连接器 %s 不支持 delete 操作，当前跳过（targetConfig=%s）", kind, job_cfg.get("table") or job_cfg.get("path")
            )
            return
        if kind == "sftp":
            file_runtime.sftp_load(config, job_cfg, row)
            return
        if kind == "ftp":
            file_runtime.ftp_load(config, job_cfg, row)
            return
        if kind == "s3":
            file_runtime.s3_load(config, job_cfg, row)
            return
        if kind == "csv_excel":
            file_runtime.csv_load(config, job_cfg, row)
            return
    if kind == "feishu":
        saas_runtime.feishu_load(config, job_cfg, row)
        return
    if kind == "yonyou_u8":
        saas_runtime.yonyou_load(config, job_cfg, row)
        return
    if kind == "fenxiangxiaoke":
        saas_runtime.fxiaoke_load(config, job_cfg, row)
        return
    if kind == "scim2":
        saas_runtime.scim_load(config, job_cfg, row, operation=operation, match_keys=match_keys)
        return
    if kind in IDENTITY_TYPES:
        saas_runtime.load_identity(kind, config, job_cfg, row, operation=operation, match_keys=match_keys)
        return
    raise RuntimeError(f"连接器 {ds_type} 尚未实现真实写入")


def _suggest_watermark_field(columns: list[dict]) -> str:
    """从列名里猜一个适合做水位线的字段。

    匹配模式（按优先级）：
    1. 明确的更新时间：updated_at / update_time / gmt_modified / modify_time
    2. 明确的创建时间：created_at / create_time
    3. 自增 / 业务序号：id（数字） / seq / serial
    """
    UPDATED_PATTERNS = (
        "updated_at", "update_at", "update_time", "updated_time",
        "gmt_modified", "modified_at", "modify_time", "last_modified",
        "last_update", "gmt_update",
    )
    CREATED_PATTERNS = (
        "created_at", "create_at", "create_time", "created_time",
        "gmt_create", "insert_time",
    )
    SERIAL_PATTERNS = ("seq", "serial", "row_no", "row_num", "business_no", "biz_no")

    names = [str(c.get("name") or "").strip() for c in columns]
    # 1) 更新时间
    lower = [n.lower() for n in names]
    for pat in UPDATED_PATTERNS:
        for i, n in enumerate(lower):
            if n == pat or n.endswith("_" + pat) or n.startswith(pat):
                return names[i]
    # 2) 创建时间
    for pat in CREATED_PATTERNS:
        for i, n in enumerate(lower):
            if n == pat or n.endswith("_" + pat) or n.startswith(pat):
                return names[i]
    # 3) 自增序号：id / 带 serial 后缀
    for pat in SERIAL_PATTERNS:
        for i, n in enumerate(lower):
            if n == pat or n.endswith("_" + pat) or n.startswith(pat):
                return names[i]
    for i, n in enumerate(lower):
        if n in ("id",):
            return names[i]
    return ""


def inspect_source(ds_type: str, config: dict, job_cfg: dict | None = None) -> dict:
    kind = _kind(ds_type)
    job_cfg = job_cfg or {}
    if kind in SQL_TYPES:
        result = sql_runtime.inspect_schema(sql_dialect(kind), config, job_cfg)
    elif kind in HTTP_TYPES:
        result = http_runtime.inspect_schema(config, job_cfg)
    elif kind in MQ_TYPES:
        from datasources.connectors import mq_runtime

        result = mq_runtime.inspect(kind, config, job_cfg)
    elif kind == "mongodb":
        result = document_runtime.mongo_inspect(config, job_cfg)
    elif kind == "elasticsearch":
        result = document_runtime.es_inspect(config, job_cfg)
    elif kind in FILE_TYPES:
        result = file_runtime.inspect_file(kind, config, job_cfg)
    elif kind in IDENTITY_TYPES:
        result = saas_runtime.inspect_identity(kind, config, job_cfg)
    elif kind == "feishu":
        result = saas_runtime.inspect_http_like(kind, saas_runtime.feishu_extract, config, job_cfg)
    elif kind == "yonyou_u8":
        result = saas_runtime.inspect_http_like(kind, saas_runtime.yonyou_extract, config, job_cfg)
    elif kind == "fenxiangxiaoke":
        result = saas_runtime.inspect_http_like(kind, saas_runtime.fxiaoke_extract, config, job_cfg)
    elif kind == "scim2":
        result = saas_runtime.inspect_http_like(kind, saas_runtime.scim_extract, config, job_cfg)
    else:
        raise RuntimeError(f"连接器 {ds_type} 不支持结构探测")
    # 附加水位线字段建议
    result["suggestedWatermarkField"] = _suggest_watermark_field(result.get("columns") or [])
    return result


def record_key(record: dict, match_keys: list[str]) -> str:
    return http_runtime._record_key(record, match_keys)
