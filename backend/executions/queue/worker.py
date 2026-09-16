"""后台 Worker：消费队列并调用 ETL。"""
from __future__ import annotations

import logging

from executions.etl import run_etl
from executions.queue import get_queue

logger = logging.getLogger(__name__)
_started = False


def start_worker() -> None:
    global _started
    if _started:
        return
    q = get_queue()
    q.set_handler(_handle)
    q.start()
    _started = True
    logger.info("ETL worker 已启动")


def _handle(job_data: dict) -> None:
    logger.info("执行任务 jobId=%s executionId=%s", job_data.get("jobId"), job_data.get("executionId"))
    from executions.dag import on_step_finished

    result = run_etl(job_data)
    if result and result.get("retrying"):
        return
    on_step_finished(job_data, result or {})
