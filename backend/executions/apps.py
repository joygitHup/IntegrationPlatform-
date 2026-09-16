from django.apps import AppConfig


class ExecutionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "executions"
    verbose_name = "任务执行"

    def ready(self) -> None:
        import logging
        import os
        import sys

        logger = logging.getLogger(__name__)

        # 仅在实际服务进程启动 worker，避免 migrate / 双重 runserver 父进程重复拉起
        if "runserver" in sys.argv and os.environ.get("RUN_MAIN") != "true":
            return
        if any(cmd in sys.argv for cmd in ("migrate", "makemigrations", "seed", "test", "collectstatic")):
            return
        from executions.queue.scheduler import start_scheduler
        from executions.queue.worker import start_worker
        from django.conf import settings

        backend = (getattr(settings, "QUEUE_BACKEND", "memory") or "memory").lower()
        if backend != "celery":
            start_worker()
        # APScheduler 缺失时不应阻断 Django 启动，仅记录错误
        try:
            start_scheduler()
        except ImportError as e:
            logger.error("调度器启动失败：%s", e)
