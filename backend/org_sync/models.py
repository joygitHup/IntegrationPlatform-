"""组织架构同步：部门树、用户-部门、同步执行记录。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class Department(StringIdModel):
    ID_PREFIX = "dept"

    job_id = models.CharField(max_length=32, db_index=True)
    source_id = models.CharField(max_length=128)
    code = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    full_name = models.CharField(max_length=256, blank=True, default="")
    parent_source_id = models.CharField(max_length=128, blank=True, default="")
    path = models.CharField(max_length=512, blank=True, default="")
    depth = models.IntegerField(default=0)
    sort_order = models.IntegerField(default=0)
    manager = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(max_length=16, default="active")
    attributes = models.JSONField(default=dict, blank=True)
    data_source = models.CharField(max_length=16, default="source")
    source_updated_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "department"


class UserDepartment(StringIdModel):
    ID_PREFIX = "udept"

    job_id = models.CharField(max_length=32, db_index=True)
    user_source_id = models.CharField(max_length=128)
    dept_source_id = models.CharField(max_length=128)
    is_primary = models.BooleanField(default=True)
    position = models.CharField(max_length=64, blank=True, default="")
    joined_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "user_department"


class DeptSyncExecution(StringIdModel):
    ID_PREFIX = "dse"

    job_id = models.CharField(max_length=32)
    execution_id = models.CharField(max_length=32)
    phase = models.CharField(max_length=16)  # dept / user_dept
    total_count = models.IntegerField(default=0)
    created_count = models.IntegerField(default=0)
    updated_count = models.IntegerField(default=0)
    deleted_count = models.IntegerField(default=0)
    failed_count = models.IntegerField(default=0)
    skipped_count = models.IntegerField(default=0)
    error_summary = models.CharField(max_length=2000, blank=True, default="")

    class Meta:
        db_table = "dept_sync_execution"
