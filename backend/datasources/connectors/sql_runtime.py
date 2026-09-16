"""关系库真实 Extract / Load / 探测。表名与列名仅允许安全标识符。"""
from __future__ import annotations

import re
from contextlib import contextmanager
from typing import Any, Iterator

IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
INTERNAL_LOAD_COLS = {"_ip_origin", "_ip_hops"}

MYSQL_LIKE = {"mysql"}
PG_LIKE = {"postgresql", "postgres", "kingbase"}
ORACLE_LIKE = {"oracle", "dameng"}
MSSQL_LIKE = {"sqlserver"}
SQL_DIALECTS = MYSQL_LIKE | PG_LIKE | ORACLE_LIKE | MSSQL_LIKE


class DriverMissing(RuntimeError):
    pass


def dialect_of(ds_type: str) -> str:
    kind = (ds_type or "").strip().lower()
    if kind in ("postgres", "postgresql"):
        return "postgresql"
    if kind in SQL_DIALECTS:
        return kind
    raise ValueError(f"不支持的 SQL 类型: {ds_type}")


def quote_ident(name: str, dialect: str) -> str:
    parts = [p for p in str(name or "").split(".") if p]
    if not parts or not all(IDENT_RE.match(p) for p in parts):
        raise ValueError(f"非法标识符: {name}")
    if dialect == "mysql":
        return ".".join(f"`{p}`" for p in parts)
    if dialect == "sqlserver":
        return ".".join(f"[{p}]" for p in parts)
    return ".".join(f'"{p}"' for p in parts)


def _filter_sql(expr: str | None, dialect: str) -> tuple[str, list[Any]] | None:
    from jobs.filter_expr import parse, to_sql

    parsed = parse(expr)
    if parsed is None:
        return None
    return to_sql(parsed, quote_ident, dialect)


def _table_name(config: dict, job_cfg: dict) -> str:
    table = (job_cfg.get("table") or job_cfg.get("path") or "").strip()
    schema = str(config.get("schema") or "").strip()
    if schema and table and "." not in table:
        return f"{schema}.{table}"
    return table


def _limit(job_cfg: dict) -> int:
    try:
        n = int(job_cfg.get("batch_size") or 1000)
    except (TypeError, ValueError):
        n = 1000
    return max(1, min(n, 100000))


def _bind(sql: str, dialect: str, params: list[Any]) -> tuple[str, list[Any]]:
    if dialect not in ORACLE_LIKE:
        return sql, params
    n = 0

    def repl(_: re.Match) -> str:
        nonlocal n
        n += 1
        return f":{n}"

    return re.sub(r"%s", repl, sql), params


def _as_dict_row(cursor, row, dialect: str) -> dict:
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    cols = [c[0] for c in (cursor.description or [])]
    return {str(cols[i]): row[i] for i in range(len(cols))}


@contextmanager
def connect(ds_type: str, config: dict) -> Iterator[Any]:
    dialect = dialect_of(ds_type)
    host = str(config.get("host") or "127.0.0.1")
    user = str(config.get("user") or config.get("username") or "")
    password = str(config.get("password") or "")
    database = str(config.get("database") or config.get("serviceName") or config.get("sid") or "")
    timeout = int(config.get("connectTimeout") or 10)

    if dialect == "mysql":
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except ImportError as exc:
            raise DriverMissing("未安装 pymysql，无法连接 MySQL。请 pip install pymysql") from exc
        conn = pymysql.connect(
            host=host,
            port=int(config.get("port") or 3306),
            user=user,
            password=password,
            database=database,
            charset=str(config.get("charset") or "utf8mb4"),
            connect_timeout=timeout,
            cursorclass=DictCursor,
            autocommit=True,
        )
    elif dialect in PG_LIKE:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise DriverMissing("未安装 psycopg，无法连接 PostgreSQL / 人大金仓。请 pip install 'psycopg[binary]'") from exc
        kwargs: dict[str, Any] = {
            "host": host,
            "port": int(config.get("port") or 5432),
            "user": user,
            "password": password,
            "dbname": database,
            "connect_timeout": timeout,
            "row_factory": dict_row,
        }
        if config.get("ssl"):
            kwargs["sslmode"] = "require"
        conn = psycopg.connect(**kwargs)
        conn.autocommit = True
    elif dialect == "sqlserver":
        try:
            import pymssql
        except ImportError as exc:
            raise DriverMissing("未安装 pymssql，无法连接 SQL Server。请 pip install pymssql") from exc
        conn = pymssql.connect(
            server=host,
            port=int(config.get("port") or 1433),
            user=user,
            password=password,
            database=database,
            login_timeout=timeout,
            as_dict=True,
        )
        conn.autocommit(True)
    elif dialect == "oracle":
        try:
            import oracledb
        except ImportError as exc:
            raise DriverMissing("未安装 oracledb，无法连接 Oracle。请 pip install oracledb") from exc
        port = int(config.get("port") or 1521)
        dsn = oracledb.makedsn(host, port, service_name=database) if database else f"{host}:{port}"
        conn = oracledb.connect(user=user, password=password, dsn=dsn)
        conn.autocommit = True
    else:  # dameng
        try:
            import dmPython
        except ImportError as exc:
            raise DriverMissing("未安装 dmPython，无法连接达梦。请按达梦文档安装 Python 驱动") from exc
        port = int(config.get("port") or 5236)
        conn = dmPython.connect(user=user, password=password, server=host, port=port)
        try:
            conn.autoCommit = True
        except Exception:
            pass
    try:
        yield conn
    finally:
        conn.close()


def test(ds_type: str, config: dict) -> dict:
    dialect = dialect_of(ds_type)
    try:
        with connect(ds_type, config) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM DUAL" if dialect in ORACLE_LIKE else "SELECT 1")
                cur.fetchone()
        return {"success": True, "message": f"{dialect} 连接成功"}
    except DriverMissing as exc:
        return {"success": False, "message": str(exc)}
    except Exception as exc:
        return {"success": False, "message": f"连接失败: {exc}"}


def _apply_limit(sql: str, dialect: str, n: int, params: list[Any]) -> tuple[str, list[Any]]:
    n = max(1, int(n))
    if dialect == "sqlserver":
        if sql.upper().lstrip().startswith("SELECT"):
            idx = sql.upper().find("SELECT")
            return sql[: idx + 6] + f" TOP {n}" + sql[idx + 6 :], params
        return sql, params
    if dialect in ORACLE_LIKE:
        return sql + f" FETCH FIRST {n} ROWS ONLY", params
    params.append(n)
    return sql + " LIMIT %s", params


def extract(ds_type: str, config: dict, job_cfg: dict) -> list[dict]:
    dialect = dialect_of(ds_type)
    table = _table_name(config, job_cfg)
    if not table:
        raise RuntimeError("请在任务源配置中填写表名（sourceConfig.table）")
    qtable = quote_ident(table, dialect)
    watermark_field = (job_cfg.get("watermark_field") or "").strip()
    watermark_value = job_cfg.get("watermark_value") or ""
    incremental = job_cfg.get("sync_mode") == "incremental" and watermark_field
    sql = f"SELECT * FROM {qtable}"
    params: list[Any] = []
    clauses: list[str] = []
    if incremental and watermark_value not in (None, ""):
        clauses.append(f"{quote_ident(watermark_field, dialect)} > %s")
        params.append(watermark_value)
    filter_sql = _filter_sql(job_cfg.get("filter_condition"), dialect)
    if filter_sql:
        clauses.append(filter_sql[0])
        params.extend(filter_sql[1])
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    if incremental:
        sql += f" ORDER BY {quote_ident(watermark_field, dialect)} ASC"
    sql, params = _apply_limit(sql, dialect, _limit(job_cfg), params)
    sql, params = _bind(sql, dialect, params)
    with connect(ds_type, config) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() or []
            return [_as_dict_row(cur, r, dialect) if not isinstance(r, dict) else dict(r) for r in rows]


def lookup(ds_type: str, config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> dict | None:
    if not match_keys:
        return None
    dialect = dialect_of(ds_type)
    table = _table_name(config, job_cfg)
    qtable = quote_ident(table, dialect)
    clauses = []
    params: list[Any] = []
    for key in match_keys:
        if key not in row:
            return None
        clauses.append(f"{quote_ident(key, dialect)} = %s")
        params.append(row[key])
    sql = f"SELECT * FROM {qtable} WHERE " + " AND ".join(clauses)
    sql, params = _apply_limit(sql, dialect, 1, params)
    sql, params = _bind(sql, dialect, params)
    with connect(ds_type, config) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            found = cur.fetchone()
            if not found:
                return None
            return dict(found) if isinstance(found, dict) else _as_dict_row(cur, found, dialect)


def insert_row(ds_type: str, config: dict, job_cfg: dict, row: dict) -> None:
    dialect = dialect_of(ds_type)
    table = _table_name(config, job_cfg)
    if not table:
        raise RuntimeError("请在任务目标配置中填写表名（targetConfig.table）")
    cols = [k for k in row.keys() if IDENT_RE.match(str(k)) and str(k) not in INTERNAL_LOAD_COLS]
    if not cols:
        raise RuntimeError("写入行没有合法列名")
    qtable = quote_ident(table, dialect)
    qcols = ", ".join(quote_ident(c, dialect) for c in cols)
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f"INSERT INTO {qtable} ({qcols}) VALUES ({placeholders})"
    params = [row[c] for c in cols]
    sql, params = _bind(sql, dialect, params)
    with connect(ds_type, config) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)


def update_row(ds_type: str, config: dict, job_cfg: dict, row: dict, match_keys: list[str]) -> int:
    dialect = dialect_of(ds_type)
    table = _table_name(config, job_cfg)
    qtable = quote_ident(table, dialect)
    set_cols = [
        k for k in row.keys()
        if IDENT_RE.match(str(k)) and k not in match_keys and str(k) not in INTERNAL_LOAD_COLS
    ]
    if not set_cols:
        return 0
    set_sql = ", ".join(f"{quote_ident(c, dialect)} = %s" for c in set_cols)
    where_sql = " AND ".join(f"{quote_ident(k, dialect)} = %s" for k in match_keys)
    params = [row[c] for c in set_cols] + [row[k] for k in match_keys]
    sql = f"UPDATE {qtable} SET {set_sql} WHERE {where_sql}"
    sql, params = _bind(sql, dialect, params)
    with connect(ds_type, config) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.rowcount or 0


def inspect_schema(ds_type: str, config: dict, job_cfg: dict | None = None) -> dict:
    dialect = dialect_of(ds_type)
    job_cfg = job_cfg or {}
    table = _table_name(config, job_cfg)
    tables: list[dict] = []
    columns: list[dict] = []
    sample: list[dict] = []
    with connect(ds_type, config) as conn:
        with conn.cursor() as cur:
            if dialect == "mysql":
                cur.execute("SHOW TABLES")
                for row in cur.fetchall() or []:
                    name = list(row.values())[0] if isinstance(row, dict) else row[0]
                    tables.append({"name": str(name)})
                if table:
                    cur.execute(f"SHOW COLUMNS FROM {quote_ident(table, dialect)}")
                    for row in cur.fetchall() or []:
                        data = dict(row) if isinstance(row, dict) else {"Field": row[0], "Type": row[1]}
                        columns.append({"name": str(data.get("Field") or data.get("field")), "type": str(data.get("Type") or data.get("type") or "")})
            elif dialect in PG_LIKE:
                cur.execute(
                    "SELECT table_schema, table_name FROM information_schema.tables "
                    "WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') "
                    "ORDER BY 1,2"
                )
                for row in cur.fetchall() or []:
                    data = dict(row) if isinstance(row, dict) else {"table_schema": row[0], "table_name": row[1]}
                    tables.append({"schema": data.get("table_schema"), "name": data.get("table_name")})
                if table:
                    tname = table.split(".")[-1]
                    cur.execute(
                        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name=%s ORDER BY ordinal_position",
                        [tname],
                    )
                    for row in cur.fetchall() or []:
                        data = dict(row) if isinstance(row, dict) else {"column_name": row[0], "data_type": row[1]}
                        columns.append({"name": data.get("column_name"), "type": data.get("data_type")})
            elif dialect == "sqlserver":
                cur.execute(
                    "SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'"
                )
                for row in cur.fetchall() or []:
                    data = dict(row) if isinstance(row, dict) else {"TABLE_SCHEMA": row[0], "TABLE_NAME": row[1]}
                    tables.append({"schema": data.get("TABLE_SCHEMA"), "name": data.get("TABLE_NAME")})
                if table:
                    tname = table.split(".")[-1]
                    cur.execute(
                        "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=%s",
                        [tname],
                    )
                    for row in cur.fetchall() or []:
                        data = dict(row) if isinstance(row, dict) else {"COLUMN_NAME": row[0], "DATA_TYPE": row[1]}
                        columns.append({"name": data.get("COLUMN_NAME"), "type": data.get("DATA_TYPE")})
            else:
                cur.execute("SELECT table_name FROM user_tables")
                for row in cur.fetchall() or []:
                    name = list(row.values())[0] if isinstance(row, dict) else row[0]
                    tables.append({"name": str(name)})
                if table:
                    tname = table.split(".")[-1].upper()
                    sql, params = _bind(
                        "SELECT column_name, data_type FROM user_tab_columns WHERE table_name=%s ORDER BY column_id",
                        dialect,
                        [tname],
                    )
                    cur.execute(sql, params)
                    for row in cur.fetchall() or []:
                        data = dict(row) if isinstance(row, dict) else {"COLUMN_NAME": row[0], "DATA_TYPE": row[1]}
                        name = data.get("COLUMN_NAME") or data.get("column_name")
                        typ = data.get("DATA_TYPE") or data.get("data_type")
                        columns.append({"name": name, "type": typ})
    if table:
        try:
            sample = extract(ds_type, config, {**job_cfg, "table": table, "sync_mode": "full", "batch_size": 20})[:20]
        except Exception:
            sample = []
        if not columns and sample:
            columns = [{"name": k, "type": ""} for k in sample[0].keys()]
    return {"dialect": dialect, "tables": tables[:200], "columns": columns, "sample": sample[:20]}
