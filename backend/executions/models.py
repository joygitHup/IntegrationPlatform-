"""执行历史、死信队列、字段变更审计、版本快照。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class JobExecution(StringIdModel):
    ID_PREFIX = "exec"

    job_id = models.CharField(max_length=32, db_index=True)
    trigger_type = models.CharField(max_length=16)  # manual / schedule / webhook / retry
    triggered_by = models.CharField(max_length=32, blank=True, default="")
    status = models.CharField(max_length=16, default="pending")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    total_rows = models.IntegerField(default=0)
    success_rows = models.IntegerField(default=0)
    failed_rows = models.IntegerField(default=0)
    skipped_rows = models.IntegerField(default=0)
    start_watermark = models.CharField(max_length=128, blank=True, default="")
    end_watermark = models.CharField(max_length=128, blank=True, default="")
    error_message = models.CharField(max_length=2000, blank=True, default="")
    error_stack = models.CharField(max_length=4000, blank=True, default="")
    retry_attempts = models.IntegerField(default=0)
    queue_job_id = models.CharField(max_length=64, blank=True, default="")
    workflow_run_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    step_id = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        db_table = "job_execution"
        indexes = [
            models.Index(fields=["status"], name="idx_exec_status"),
            models.Index(fields=["job_id", "created_at"], name="idx_exec_job_created"),
        ]


class DeadLetterMessage(StringIdModel):
    ID_PREFIX = "dlq"

    job_id = models.CharField(max_length=32, db_index=True)
    execution_id = models.CharField(max_length=32, db_index=True)
    payload = models.JSONField(default=dict)
    is_desensitized = models.BooleanField(default=False)
    payload_hash = models.CharField(max_length=64, blank=True, default="")
    error_message = models.CharField(max_length=2000, blank=True, default="")
    error_type = models.CharField(max_length=64, blank=True, default="")
    retry_count = models.IntegerField(default=0)
    status = models.CharField(max_length=16, default="pending")  # pending / reprocessed / ignored
    processed_at = models.DateTimeField(null=True, blank=True)
    processed_by = models.CharField(max_length=32, blank=True, default="")

    class Meta:
        db_table = "dead_letter_message"


class FieldChangeAudit(StringIdModel):
    ID_PREFIX = "fca"

    job_id = models.CharField(max_length=32, db_index=True)
    execution_id = models.CharField(max_length=32, db_index=True)
    record_key = models.CharField(max_length=256, db_index=True)
    operation = models.CharField(max_length=16)  # create / update / delete / skip_conflict
    changes = models.JSONField(default=list)
    before_hash = models.CharField(max_length=64, blank=True, default="")
    after_hash = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        db_table = "field_change_audit"


class DataVersionSnapshot(StringIdModel):
    ID_PREFIX = "dvs"

    job_id = models.CharField(max_length=32, db_index=True)
    execution_id = models.CharField(max_length=32, db_index=True)
    version = models.IntegerField(default=1)
    snapshot_type = models.CharField(max_length=8)  # before / after
    record_count = models.IntegerField(default=0)
    snapshot_data = models.JSONField(default=list)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "data_version_snapshot"


class WorkflowRun(StringIdModel):
    ID_PREFIX = "wfr"

    job_id = models.CharField(max_length=32, db_index=True)
    trigger_type = models.CharField(max_length=16, default="manual")
    triggered_by = models.CharField(max_length=32, blank=True, default="")
    status = models.CharField(max_length=16, default="pending")
    step_states = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "workflow_run"


class SchedulerLease(models.Model):
    name = models.CharField(max_length=64, primary_key=True)
    owner = models.CharField(max_length=128, blank=True, default="")
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "scheduler_lease"
