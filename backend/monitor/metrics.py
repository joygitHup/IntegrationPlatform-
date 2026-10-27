"""Prometheus 指标。无 prometheus_client 时仍输出真实计数文本。"""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from functools import wraps

CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"

try:
    from prometheus_client import CONTENT_TYPE_LATEST as _PROM_CT
    from prometheus_client import Counter, Gauge, Histogram, generate_latest

    ETL_RUNS = Counter("ip_etl_runs_total", "ETL 执行次数", ["status", "environment"])
    ETL_ROWS = Counter("ip_etl_rows_total", "ETL 处理行数", ["result", "environment"])
    ETL_DELETE_ROWS = Counter("ip_etl_delete_rows_total", "ETL 删除行数（软删信号触发 delete 分支）", ["connector", "environment"])
    ETL_DURATION = Histogram("ip_etl_duration_seconds", "ETL 耗时", ["environment"])
    QUEUE_ENQUEUED = Counter("ip_queue_enqueued_total", "入队次数", ["backend", "environment"])
    SSO_LOGINS = Counter("ip_sso_logins_total", "SSO 登录", ["login_type", "result"])
    QUEUE_DEPTH = Gauge("ip_queue_depth", "内存队列深度")
    HAVE_PROM = True
    CONTENT_TYPE_LATEST = _PROM_CT
except ImportError:  # pragma: no cover
    ETL_RUNS = ETL_ROWS = ETL_DELETE_ROWS = ETL_DURATION = QUEUE_ENQUEUED = SSO_LOGINS = QUEUE_DEPTH = None
    HAVE_PROM = False
    generate_latest = None

_lock = threading.Lock()
_mem = {
    "etl_runs": defaultdict(int),
    "etl_rows": defaultdict(int),
    "etl_delete_rows": defaultdict(int),
    "etl_duration_sum": 0.0,
    "etl_duration_count": 0,
    "queue_enqueued": 0,
    "queue_depth": 0,
    "sso_logins": defaultdict(int),
}


def observe_etl(*, status: str, duration_ms: int, success_rows: int, failed_rows: int, skipped_rows: int, environment: str = "dev") -> None:
    env = environment or "dev"
    seconds = max((duration_ms or 0) / 1000.0, 0)
    with _lock:
        _mem["etl_runs"][status or "unknown"] += 1
        _mem["etl_rows"]["success"] += success_rows or 0
        _mem["etl_rows"]["failed"] += failed_rows or 0
        _mem["etl_rows"]["skipped"] += skipped_rows or 0
        _mem["etl_duration_sum"] += seconds
        _mem["etl_duration_count"] += 1
    if HAVE_PROM:
        ETL_RUNS.labels(status=status or "unknown", environment=env).inc()
        ETL_ROWS.labels(result="success", environment=env).inc(success_rows or 0)
        ETL_ROWS.labels(result="failed", environment=env).inc(failed_rows or 0)
        ETL_ROWS.labels(result="skipped", environment=env).inc(skipped_rows or 0)
        ETL_DURATION.labels(environment=env).observe(seconds)


def observe_enqueue(*, backend: str, environment: str = "dev") -> None:
    with _lock:
        _mem["queue_enqueued"] += 1
    if HAVE_PROM:
        QUEUE_ENQUEUED.labels(backend=backend or "memory", environment=environment or "dev").inc()


def observe_sso(*, login_type: str, result: str) -> None:
    with _lock:
        _mem["sso_logins"][f"{login_type or 'unknown'}:{result or 'unknown'}"] += 1
    if HAVE_PROM:
        SSO_LOGINS.labels(login_type=login_type or "unknown", result=result or "unknown").inc()


def observe_delete(*, connector: str, count: int = 1, environment: str = "dev") -> None:
    """软删信号触发 delete 分支时调用，统计按连接器/环境的 delete 行数。"""
    with _lock:
        _mem["etl_delete_rows"][f"{connector or 'unknown'}:{environment or 'dev'}"] += int(count or 1)
    if HAVE_PROM:
        ETL_DELETE_ROWS.labels(connector=connector or "unknown", environment=environment or "dev").inc(count or 1)


def set_queue_depth(n: int) -> None:
    with _lock:
        _mem["queue_depth"] = int(n or 0)
    if HAVE_PROM:
        QUEUE_DEPTH.set(n)


def timed(metric):
    def deco(fn):
        @wraps(fn)
        def inner(*args, **kwargs):
            start = time.perf_counter()
            try:
                return fn(*args, **kwargs)
            finally:
                if HAVE_PROM and metric is not None:
                    metric.observe(time.perf_counter() - start)
        return inner
    return deco


def snapshot_metrics() -> dict:
    with _lock:
        sso = dict(_mem["sso_logins"])
        return {
            "backend": "prometheus_client" if HAVE_PROM else "memory",
            "scrapePath": "/api/metrics",
            "etlRuns": dict(_mem["etl_runs"]),
            "etlRows": dict(_mem["etl_rows"]),
            "etlDurationSeconds": {
                "sum": round(_mem["etl_duration_sum"], 3),
                "count": _mem["etl_duration_count"],
            },
            "queueEnqueued": _mem["queue_enqueued"],
            "queueDepth": _mem["queue_depth"],
            "ssoLogins": sso,
        }


def _render_memory() -> bytes:
    snap = snapshot_metrics()
    lines = [
        "# HELP ip_up 1 if process is up",
        "# TYPE ip_up gauge",
        "ip_up 1",
        "# HELP ip_etl_runs_total ETL 执行次数",
        "# TYPE ip_etl_runs_total counter",
    ]
    for status, count in (snap["etlRuns"] or {}).items():
        lines.append(f'ip_etl_runs_total{{status="{status}"}} {count}')
    lines += [
        "# HELP ip_etl_rows_total ETL 处理行数",
        "# TYPE ip_etl_rows_total counter",
    ]
    for result, count in (snap["etlRows"] or {}).items():
        lines.append(f'ip_etl_rows_total{{result="{result}"}} {count}')
    lines += [
        "# HELP ip_etl_duration_seconds ETL 耗时",
        "# TYPE ip_etl_duration_seconds summary",
        f'ip_etl_duration_seconds_sum {snap["etlDurationSeconds"]["sum"]}',
        f'ip_etl_duration_seconds_count {snap["etlDurationSeconds"]["count"]}',
        "# HELP ip_queue_enqueued_total 入队次数",
        "# TYPE ip_queue_enqueued_total counter",
        f'ip_queue_enqueued_total {snap["queueEnqueued"]}',
        "# HELP ip_queue_depth 内存队列深度",
        "# TYPE ip_queue_depth gauge",
        f'ip_queue_depth {snap["queueDepth"]}',
        "# HELP ip_sso_logins_total SSO 登录",
        "# TYPE ip_sso_logins_total counter",
    ]
    for key, count in (snap["ssoLogins"] or {}).items():
        login_type, _, result = key.partition(":")
        lines.append(f'ip_sso_logins_total{{login_type="{login_type}",result="{result}"}} {count}')
    lines.append("")
    return ("\n".join(lines)).encode("utf-8")


def render_metrics() -> tuple[bytes, str]:
    if HAVE_PROM:
        return generate_latest(), CONTENT_TYPE_LATEST
    return _render_memory(), CONTENT_TYPE_LATEST
