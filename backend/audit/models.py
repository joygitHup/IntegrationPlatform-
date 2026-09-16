"""操作审计日志。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class AuditLog(StringIdModel):
    ID_PREFIX = "audit"

    user_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    username = models.CharField(max_length=64, blank=True, default="")
    # 客户账号操作强制写入所属集成商；平台操作为 ""（全站可见）
    client_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    action = models.CharField(max_length=32)  # LOGIN / CREATE / UPDATE / DELETE / EXECUTE
    resource_type = models.CharField(max_length=64, blank=True, default="")
    resource_id = models.CharField(max_length=64, blank=True, default="")
    resource_name = models.CharField(max_length=256, blank=True, default="")
    detail = models.JSONField(null=True, blank=True)
    ip = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=512, blank=True, default="")
    trace_id = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        db_table = "sys_audit_log"
        indexes = [
            models.Index(fields=["action"], name="idx_audit_action"),
            models.Index(fields=["created_at"], name="idx_audit_created_at"),
        ]
