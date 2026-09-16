"""集成商凭证：API Key 访问开放服务，无需登录中台控制台。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class IntegrationClient(StringIdModel):
    ID_PREFIX = "ic"

    name = models.CharField(max_length=128)
    code = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=500, blank=True, default="")
    key_prefix = models.CharField(max_length=16, db_index=True)
    key_hash = models.CharField(max_length=64, unique=True)
    scopes = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=16, default="active")
    callback_url = models.CharField(max_length=500, blank=True, default="")
    ip_whitelist = models.JSONField(default=list, blank=True)
    rate_limit_per_minute = models.IntegerField(default=60)
    monthly_call_quota = models.IntegerField(default=0)
    monthly_row_quota = models.IntegerField(default=0)
    sandbox = models.BooleanField(default=False)
    alert_email = models.CharField(max_length=255, blank=True, default="")
    alert_webhook_url = models.CharField(max_length=500, blank=True, default="")
    created_by = models.CharField(max_length=32, blank=True, default="")
    last_used_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_integration_clients"


class PartnerWorkspace(StringIdModel):
    ID_PREFIX = "ws"

    client_id = models.CharField(max_length=32, db_index=True)
    name = models.CharField(max_length=128)
    code = models.CharField(max_length=64)
    environment = models.CharField(max_length=16, blank=True, default="")
    status = models.CharField(max_length=16, default="active")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_partner_workspaces"
        unique_together = [("client_id", "code")]


class ClientUsageDaily(StringIdModel):
    ID_PREFIX = "usg"

    client_id = models.CharField(max_length=32, db_index=True)
    day = models.DateField()
    api_calls = models.IntegerField(default=0)
    rows_written = models.IntegerField(default=0)

    class Meta:
        db_table = "sys_client_usage_daily"
        unique_together = [("client_id", "day")]


class IdempotencyRecord(StringIdModel):
    ID_PREFIX = "idk"

    scope = models.CharField(max_length=64, db_index=True)
    key = models.CharField(max_length=128)
    path = models.CharField(max_length=200, blank=True, default="")
    status_code = models.IntegerField(default=200)
    response_json = models.JSONField(default=dict)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sys_idempotency_keys"
        unique_together = [("scope", "key")]


class ClientEntitlement(StringIdModel):
    """集成商授权（配额）。所有上限 0 = 不限；私有化无记录时按全 0 处理，开箱即用。"""
    ID_PREFIX = "ent"

    client_id = models.CharField(max_length=32, unique=True, db_index=True)
    max_jobs = models.IntegerField(default=0)            # 集成任务数上限
    max_seats = models.IntegerField(default=0)           # 席位（启用账号数）上限
    max_connectors = models.IntegerField(default=0)      # 数据源/连接器登记数上限
    max_rows_monthly = models.IntegerField(default=0)    # 每月写入行数上限
    max_api_calls_monthly = models.IntegerField(default=0)  # 每月 API 调用次数上限
    note = models.CharField(max_length=255, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_client_entitlements"
