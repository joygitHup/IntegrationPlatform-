"""Celery 应用。QUEUE_BACKEND=celery 且配置 REDIS_URL 时使用。"""
from __future__ import annotations

import os

import django
from celery import Celery
from django.conf import settings as djsettings

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
if not djsettings.configured:
    django.setup()

app = Celery("integration_platform")
app.conf.update(
    broker_url=os.getenv("REDIS_URL") or os.getenv("CELERY_BROKER_URL") or "redis://127.0.0.1:6379/0",
    result_backend=os.getenv("CELERY_RESULT_BACKEND") or os.getenv("REDIS_URL") or "redis://127.0.0.1:6379/0",
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_default_queue=f"etl-{(os.getenv('ENVIRONMENT') or 'dev')}",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)
app.autodiscover_tasks(["executions.queue"])


@app.task(name="executions.run_etl", bind=True, max_retries=0)
def run_etl_task(self, job_data: dict):
    from executions.etl import run_etl
    from executions.dag import on_step_finished

    result = run_etl(job_data)
    if not (result and result.get("retrying")):
        on_step_finished(job_data, result or {})
    return result
