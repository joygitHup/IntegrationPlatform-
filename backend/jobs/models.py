"""集成任务：映射规则、水位线、调度、冲突策略。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class IntegrationJob(StringIdModel):
    ID_PREFIX = "job"

    name = models.CharField(max_length=128)
    code = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=255, blank=True, default="")

    source_datasource_id = models.CharField(max_length=32, db_index=True)
    target_datasource_id = models.CharField(max_length=32, db_index=True)
    source_config = models.JSONField(default=dict)
    target_config = models.JSONField(default=dict)
    field_mapping = models.JSONField(default=list)
    filter_condition = models.CharField(max_length=1024, blank=True, default="")

    sync_mode = models.CharField(max_length=16, default="full")  # full / incremental
    watermark_strategy = models.CharField(max_length=16, default="timestamp")
    watermark_field = models.CharField(max_length=64, blank=True, default="")
    watermark_value = models.CharField(max_length=128, blank=True, default="")
    last_watermark_value = models.CharField(max_length=128, blank=True, default="")
    last_execution_at = models.DateTimeField(null=True, blank=True)

    schedule_type = models.CharField(max_length=16, default="manual")  # manual / cron / event / webhook
    schedule_cron = models.CharField(max_length=64, blank=True, default="")
    batch_size = models.IntegerField(default=1000)
    concurrency = models.IntegerField(default=1)
    retry_count = models.IntegerField(default=3)
    retry_interval = models.IntegerField(default=60)

    write_mode = models.CharField(max_length=16, default="insert")  # insert / upsert / update_only
    match_keys = models.JSONField(default=list)
    conflict_strategy = models.CharField(max_length=20, default="source_wins")
    conflict_compare_field = models.CharField(max_length=64, blank=True, default="")

    callback_url = models.CharField(max_length=500, blank=True, default="")
    webhook_secret = models.CharField(max_length=128, blank=True, default="")
    alert_email = models.CharField(max_length=255, blank=True, default="")
    alert_webhook_url = models.CharField(max_length=500, blank=True, default="")

    sensitive_fields = models.JSONField(default=list)
    desensitize_mode = models.CharField(max_length=12, default="mask")
    enable_change_audit = models.BooleanField(default=False)
    enable_version_snapshot = models.BooleanField(default=False)
    version_retention_days = models.IntegerField(default=30)
    template_type = models.CharField(max_length=20, default="generic")

    dag_steps = models.JSONField(default=list, blank=True)
    sync_direction = models.CharField(max_length=16, default="forward")  # forward / reverse / bidirectional
    origin_marker_field = models.CharField(max_length=64, blank=True, default="_ip_origin")
    origin_system_id = models.CharField(max_length=64, blank=True, default="")
    pair_job_id = models.CharField(max_length=32, blank=True, default="")
    environment = models.CharField(max_length=16, default="dev", db_index=True)

    status = models.CharField(max_length=16, default="stopped")  # running / stopped / paused / error
    version = models.IntegerField(default=1)
    created_by = models.CharField(max_length=32, blank=True, default="")
    client_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    workspace_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "integration_job"
        indexes = [
            models.Index(fields=["status"], name="idx_job_status"),
            models.Index(fields=["schedule_type", "status"], name="idx_job_schedule"),
        ]
