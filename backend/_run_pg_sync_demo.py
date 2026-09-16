"""One-shot: local Postgres -> Docker Postgres via platform API. Do not commit."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

API = "http://127.0.0.1:8000/api"
CONTAINER = "ip_pg_target"
SRC_DB = "ip_demo_src"
TGT_DB = "ip_target"
TABLE = "demo_customers"
DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  amount numeric(12,2) NOT NULL,
  updated_at timestamp NOT NULL
);
"""
ROWS = [
    (1, "张三", "zhangsan@example.com", "128.50", "2026-09-11 10:00:00"),
    (2, "李四", "lisi@example.com", "256.00", "2026-09-11 10:01:00"),
    (3, "王五", "wangwu@example.com", "88.80", "2026-09-11 10:02:00"),
]


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def pick_docker_pg_port() -> int:
    port = 5432
    while port_open(port):
        port += 1
        if port > 5450:
            raise RuntimeError("5432-5450 均被占用，无法启动 Docker PostgreSQL")
    return port


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, capture_output=True, text=True)


def ensure_docker_postgres(port: int, password: str) -> None:
    existing = run(["docker", "ps", "-a", "--filter", f"name=^{CONTAINER}$", "--format", "{{.Names}}"])
    if CONTAINER in (existing.stdout or ""):
        run(["docker", "rm", "-f", CONTAINER], check=False)
    run([
        "docker", "run", "-d",
        "--name", CONTAINER,
        "-e", "POSTGRES_USER=postgres",
        "-e", f"POSTGRES_PASSWORD={password}",
        "-e", f"POSTGRES_DB={TGT_DB}",
        "-p", f"{port}:5432",
        "postgres:15-alpine",
    ])
    for _ in range(40):
        ready = run(["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"], check=False)
        if ready.returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError("Docker PostgreSQL 未就绪: " + (ready.stderr or ready.stdout or ""))


def admin_conn(local_url: str):
    parsed = urlparse(local_url)
    return psycopg.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 5432,
        user=parsed.username or "postgres",
        password=parsed.password or "",
        dbname="postgres",
        autocommit=True,
    )


def setup_source(local_url: str) -> dict:
    parsed = urlparse(local_url)
    user = parsed.username or "postgres"
    password = parsed.password or ""
    host = parsed.hostname or "127.0.0.1"
    port = int(parsed.port or 5432)
    with admin_conn(local_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (SRC_DB,))
            if not cur.fetchone():
                cur.execute(f'CREATE DATABASE "{SRC_DB}"')
    with psycopg.connect(host=host, port=port, user=user, password=password, dbname=SRC_DB, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute(f"TRUNCATE {TABLE}")
            cur.executemany(
                f"INSERT INTO {TABLE} (id, name, email, amount, updated_at) VALUES (%s, %s, %s, %s, %s)",
                ROWS,
            )
            cur.execute(f"SELECT count(*) FROM {TABLE}")
            count = cur.fetchone()[0]
    return {"host": host, "port": port, "database": SRC_DB, "user": user, "password": password, "schema": "public", "rows": count}


def setup_target(port: int, password: str) -> dict:
    with psycopg.connect(
        host="127.0.0.1", port=port, user="postgres", password=password, dbname=TGT_DB, autocommit=True,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            cur.execute(f"TRUNCATE {TABLE}")
            cur.execute(f"SELECT count(*) FROM {TABLE}")
            count = cur.fetchone()[0]
    return {
        "host": "127.0.0.1", "port": port, "database": TGT_DB,
        "user": "postgres", "password": password, "schema": "public", "rows": count,
    }


def api(method: str, path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(f"{API}{path}", data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> {exc.code} {raw}") from exc


def find_by_code(items: list, code: str):
    return next((x for x in items if x.get("code") == code), None)


def upsert_datasource(token: str, payload: dict) -> str:
    listed = api("GET", "/datasources?pageSize=100", token)
    found = find_by_code(listed.get("items") or [], payload["code"])
    if found:
        api("PUT", f"/datasources/{found['id']}", token, {
            "name": payload["name"], "type": payload["type"], "config": payload["config"], "status": "active",
        })
        return found["id"]
    created = api("POST", "/datasources", token, payload)
    return created["id"]


def upsert_job(token: str, payload: dict) -> str:
    listed = api("GET", "/jobs?pageSize=100", token)
    found = find_by_code(listed.get("items") or [], payload["code"])
    if found:
        api("PUT", f"/jobs/{found['id']}", token, payload)
        return found["id"]
    created = api("POST", "/jobs", token, payload)
    return created["id"]


def count_target(port: int, password: str) -> int:
    with psycopg.connect(
        host="127.0.0.1", port=port, user="postgres", password=password, dbname=TGT_DB, row_factory=dict_row,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT count(*) AS n FROM {TABLE}")
            return int(cur.fetchone()["n"])


def main() -> None:
    local_url = os.environ["DATABASE_URL"]
    parsed = urlparse(local_url)
    docker_password = parsed.password or "postgres"
    docker_port = pick_docker_pg_port()
    print(f"local_pg_port={parsed.port or 5432}")
    print(f"docker_pg_port={docker_port}")
    ensure_docker_postgres(docker_port, docker_password)
    source = setup_source(local_url)
    target = setup_target(docker_port, docker_password)
    print(f"source_rows={source['rows']} target_rows_before={target['rows']}")

    token = api("POST", "/auth/login", body={"username": "admin", "password": "admin123"})["accessToken"]
    src_cfg = {k: source[k] for k in ("host", "port", "database", "user", "password", "schema")}
    tgt_cfg = {k: target[k] for k in ("host", "port", "database", "user", "password", "schema")}
    src_id = upsert_datasource(token, {
        "name": "本地 PostgreSQL 演示源",
        "code": "localPgDemoSrc",
        "type": "postgresql",
        "config": src_cfg,
        "description": "本机 PostgreSQL ip_demo_src.demo_customers",
        "status": "active",
    })
    tgt_id = upsert_datasource(token, {
        "name": "Docker PostgreSQL 演示目标",
        "code": "dockerPgDemoTgt",
        "type": "postgresql",
        "config": tgt_cfg,
        "description": f"Docker PostgreSQL 127.0.0.1:{docker_port}/{TGT_DB}",
        "status": "active",
    })
    print("test_source", api("POST", "/datasources/test", token, {"id": src_id}))
    print("test_target", api("POST", "/datasources/test", token, {"id": tgt_id}))

    mapping = [
        {"source": "id", "target": "id", "transform": ""},
        {"source": "name", "target": "name", "transform": ""},
        {"source": "email", "target": "email", "transform": ""},
        {"source": "amount", "target": "amount", "transform": ""},
        {"source": "updated_at", "target": "updated_at", "transform": ""},
    ]
    job_id = upsert_job(token, {
        "name": "本地PG导入Docker PG",
        "code": "jobLocalToDockerPg",
        "sourceDatasourceId": src_id,
        "targetDatasourceId": tgt_id,
        "syncMode": "full",
        "scheduleType": "manual",
        "writeMode": "insert",
        "matchKeys": ["id"],
        "sourceConfig": {"table": TABLE, "path": TABLE},
        "targetConfig": {"table": TABLE, "path": TABLE},
        "fieldMapping": mapping,
        "batchSize": 1000,
        "retryCount": 0,
    })
    queued = api("POST", "/jobs/trigger", token, {"jobId": job_id})
    print("queued", queued)
    execution_id = queued["executionId"]
    detail = {}
    for _ in range(40):
        time.sleep(1)
        detail = api("GET", f"/executions/{execution_id}", token)
        status = detail.get("status")
        print(f"execution_status={status}")
        if status in ("success", "failed", "partial_failed"):
            break
    after = count_target(docker_port, docker_password)
    print(json.dumps({
        "dockerPgPort": docker_port,
        "sourceTable": f"{SRC_DB}.public.{TABLE}",
        "targetTable": f"{TGT_DB}.public.{TABLE}",
        "sourceRows": source["rows"],
        "targetRowsAfter": after,
        "executionId": execution_id,
        "status": detail.get("status"),
        "processedRows": detail.get("processedRows"),
        "successRows": detail.get("successRows"),
        "failedRows": detail.get("failedRows"),
        "errorMessage": detail.get("errorMessage") or "",
    }, ensure_ascii=False, indent=2))
    if detail.get("status") != "success" or after != source["rows"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
