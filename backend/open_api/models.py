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
    # 白标 / 嵌入页配置
    branding_logo_url = models.URLField(blank=True, default="")
    branding_logo_dark_url = models.URLField(blank=True, default="")
    branding_primary_color = models.CharField(max_length=7, blank=True, default="")
    branding_secondary_color = models.CharField(max_length=7, blank=True, default="")
    branding_company_name = models.CharField(max_length=128, blank=True, default="")
    branding_product_name = models.CharField(max_length=128, blank=True, default="")
    embed_token = models.CharField(max_length=64, blank=True, default="")
    # 轮换宽限期：旧 token 在 embed_token_prev_expires_at 之前仍可通过校验
    embed_token_prev = models.CharField(max_length=64, blank=True, default="")
    embed_token_prev_expires_at = models.DateTimeField(null=True, blank=True)
    embed_allowed_origins = models.JSONField(default=list, blank=True)

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

    PLAN_TRIAL = "trial"
    PLAN_STANDARD = "standard"
    PLAN_PROFESSIONAL = "professional"
    PLAN_ENTERPRISE = "enterprise"
    PLAN_CHOICES = (
        (PLAN_TRIAL, "试用版"),
        (PLAN_STANDARD, "标准版"),
        (PLAN_PROFESSIONAL, "专业版"),
        (PLAN_ENTERPRISE, "旗舰私有化"),
    )

    client_id = models.CharField(max_length=32, unique=True, db_index=True)
    plan = models.CharField(max_length=16, default=PLAN_STANDARD, choices=PLAN_CHOICES)
    expires_at = models.DateTimeField(null=True, blank=True, help_text="试用版到期时间（到期自动冻结）")
    plan_features_json = models.JSONField(default=dict, blank=True, help_text="显式覆写 feature gate")
    max_jobs = models.IntegerField(default=0)            # 集成任务数上限
    max_seats = models.IntegerField(default=0)           # 席位（启用账号数）上限
    max_connectors = models.IntegerField(default=0)      # 数据源/连接器登记数上限
    max_rows_monthly = models.IntegerField(default=0)    # 每月写入行数上限
    max_api_calls_monthly = models.IntegerField(default=0)  # 每月 API 调用次数上限
    note = models.CharField(max_length=255, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_client_entitlements"


class BillingPlan(StringIdModel):
    """按 client_id 绑定的计费套餐（阶梯价、免费额度、基费）。"""
    ID_PREFIX = "bp"

    client_id = models.CharField(max_length=32, db_index=True)
    price_per_row = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    price_per_api_call = models.DecimalField(max_digits=10, decimal_places=4, default=0)
    monthly_base_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    free_rows_per_month = models.BigIntegerField(default=0)
    free_api_calls_per_month = models.BigIntegerField(default=0)
    currency = models.CharField(max_length=3, default="CNY")
    tax_rate = models.DecimalField(max_digits=5, decimal_places=4, default=0.06)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, default="active")  # active/suspended/archived

    note = models.CharField(max_length=255, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_billing_plans"
        # 生命周期约束：业务层保证同一时刻只有一条 active；
        # 数据库层用 unique_together 避免同一 client 的同一状态（active/archived）出现多条。
        # 这样归档后可以新建，不撞 unique 约束。
        unique_together = [("client_id", "status")]


class Invoice(StringIdModel):
    """月度账单（每月 1 号自动生成上月数据；支持重算/发票导出）。"""
    ID_PREFIX = "inv"

    client_id = models.CharField(max_length=32, db_index=True)
    period_start = models.DateField()
    period_end = models.DateField()
    # 用量快照（生成时冻结，避免后续 bump 影响账单金额）
    rows_written = models.BigIntegerField(default=0)
    rows_invoiced = models.BigIntegerField(default=0)
    api_calls = models.BigIntegerField(default=0)
    api_calls_invoiced = models.BigIntegerField(default=0)
    # 金额
    base_fee = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    rows_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    api_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    currency = models.CharField(max_length=3, default="CNY")
    # 状态流转
    status = models.CharField(max_length=16, default="draft")  # draft/issued/paid/void
    invoice_number = models.CharField(max_length=32, unique=True, blank=True, default="")
    issued_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.CharField(max_length=255, blank=True, default="")
    pdf_url = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_invoices"
        unique_together = [("client_id", "period_start")]
