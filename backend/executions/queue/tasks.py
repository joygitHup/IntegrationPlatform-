"""供 Celery autodiscover 使用。"""
from executions.queue.celery_app import run_etl_task  # noqa: F401
