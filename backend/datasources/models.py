"""数据源。敏感字段加密存储，列表接口脱敏。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class Datasource(StringIdModel):
    ID_PREFIX = "ds"

    name = models.CharField(max_length=128)
    code = models.CharField(max_length=64, unique=True)
    type = models.CharField(max_length=32)  # mysql / postgresql / http_api / ...
    config = models.JSONField(default=dict)
    description = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=16, default="active")
    last_test_status = models.CharField(max_length=16, blank=True, default="")  # success / failed
    last_test_at = models.DateTimeField(null=True, blank=True)
    last_test_error = models.CharField(max_length=512, blank=True, default="")
    created_by = models.CharField(max_length=32, blank=True, default="")
    client_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    workspace_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    environment = models.CharField(max_length=16, default="dev", db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "datasource"
        indexes = [
            models.Index(fields=["type"], name="idx_ds_type"),
            models.Index(fields=["code"], name="idx_ds_code"),
        ]
