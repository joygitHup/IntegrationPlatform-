"""
队列抽象层。

QUEUE_BACKEND=memory 使用进程内线程队列（开发默认）。
QUEUE_BACKEND=celery 走 Redis Broker。
"""
from __future__ import annotations

import logging
import queue
import threading
from typing import Any, Callable, Protocol

from django.conf import settings

from core.ids import generate_id
from monitor.metrics import observe_enqueue, set_queue_depth

logger = logging.getLogger(__name__)


class QueueLike(Protocol):
    def set_handler(self, handler: Callable[[dict], None]) -> None: ...
    def add(self, job_data: dict[str, Any], delay_seconds: int = 0) -> str: ...
    def start(self) -> None: ...
    def size(self) -> int: ...


class InMemoryQueue:
    def __init__(self) -> None:
        self._q: queue.Queue = queue.Queue()
        self._handler: Callable[[dict], None] | None = None
        self._thread: threading.Thread | None = None
        self._started = False

    def set_handler(self, handler: Callable[[dict], None]) -> None:
        self._handler = handler

    def add(self, job_data: dict[str, Any], delay_seconds: int = 0) -> str:
        job_id = generate_id("qjob")
        item = {**job_data, "_queueJobId": job_id}

        def _enqueue() -> None:
            self._q.put(item)
            set_queue_depth(self._q.qsize())
            observe_enqueue(backend="memory", environment=str(getattr(settings, "ENVIRONMENT", "dev")))

        delay = max(0, int(delay_seconds or 0))
        if delay > 0:
            timer = threading.Timer(delay, _enqueue)
            timer.daemon = True
            timer.start()
            return job_id
        _enqueue()
        return job_id

    def size(self) -> int:
        return self._q.qsize()

    def start(self) -> None:
        if self._started:
            return
        self._started = True

        def _loop() -> None:
            while True:
                item = self._q.get()
                set_queue_depth(self._q.qsize())
                try:
                    if self._handler:
                        self._handler(item)
                except Exception:
                    logger.exception("队列任务执行失败")
                finally:
                    self._q.task_done()

        self._thread = threading.Thread(target=_loop, name="etl-worker", daemon=True)
        self._thread.start()


class CeleryQueue:
    def __init__(self) -> None:
        self._handler = None

    def set_handler(self, handler: Callable[[dict], None]) -> None:
        self._handler = handler

    def add(self, job_data: dict[str, Any], delay_seconds: int = 0) -> str:
        from executions.queue.celery_app import run_etl_task

        job_id = generate_id("qjob")
        payload = {**job_data, "_queueJobId": job_id}
        delay = max(0, int(delay_seconds or 0))
        if delay > 0:
            run_etl_task.apply_async(args=[payload], countdown=delay)
        else:
            run_etl_task.delay(payload)
        observe_enqueue(backend="celery", environment=str(getattr(settings, "ENVIRONMENT", "dev")))
        return job_id

    def size(self) -> int:
        from executions.queue.celery_app import app
        from monitor.metrics import set_queue_depth

        # 从 Celery 应用配置获取队列名（默认 celery）
        queue_name = getattr(app.conf, "task_default_queue", None) or "celery"
        broker_url = getattr(app.conf, "broker_url", None)
        if not broker_url:
            # 未配置 Redis broker，深度未知，用 -1 区分于空队列
            set_queue_depth(-1)
            return -1
        try:
            import redis
        except ImportError:
            logger.warning("未安装 redis 客户端，无法查询队列深度")
            set_queue_depth(-1)
            return -1
        try:
            client = redis.Redis.from_url(broker_url, socket_connect_timeout=2, socket_timeout=2)
            depth = client.llen(queue_name)
            set_queue_depth(depth)
            return int(depth)
        except Exception:
            logger.exception("查询 Celery 队列深度失败")
            # Redis 不可用时返回 -1，监控据此识别为未知而非空
            set_queue_depth(-1)
            return -1

    def start(self) -> None:
        logger.info("Celery 队列已启用，请单独启动 worker: celery -A executions.queue.celery_app worker -l info")


_queue: QueueLike | None = None


def get_queue() -> QueueLike:
    global _queue
    if _queue is None:
        backend = (getattr(settings, "QUEUE_BACKEND", "memory") or "memory").lower()
        if backend == "celery":
            _queue = CeleryQueue()
        else:
            _queue = InMemoryQueue()
    return _queue
