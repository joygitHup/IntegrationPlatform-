from rest_framework import serializers

from jobs.job_utils import JOB_CODE_PATTERN
from jobs.models import IntegrationJob


class JobSerializer(serializers.ModelSerializer):
    webhook_url = serializers.SerializerMethodField()

    class Meta:
        model = IntegrationJob
        fields = "__all__"
        read_only_fields = [
            "id", "created_at", "updated_at", "created_by", "version",
            "watermark_value", "last_watermark_value", "last_execution_at",
        ]

    def get_webhook_url(self, obj: IntegrationJob) -> str:
        """当 schedule_type=webhook 时返回公开 webhook URL。"""
        if (getattr(obj, "schedule_type", "") or "") != "webhook":
            return ""
        try:
            from django.conf import settings

            base = str(getattr(settings, "PUBLIC_BASE_URL", "") or "")
            if not base:
                request = self.context.get("request")
                if request:
                    base = f"{request.scheme}://{request.get_host()}"
            prefix = str(getattr(settings, "PUBLIC_API_PREFIX", "/api") or "/api")
            return f"{base.rstrip('/')}{prefix}/open/hooks/{obj.code}"
        except Exception:
            return ""


class CreateJobSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=128)
    code = serializers.RegexField(
        JOB_CODE_PATTERN,
        max_length=64,
        error_messages={"invalid": "编码只能以字母开头，可包含字母、数字、下划线和中划线"},
    )
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    source_datasource_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    target_datasource_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    source_config = serializers.DictField(required=False, default=dict)
    target_config = serializers.DictField(required=False, default=dict)
    field_mapping = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    filter_condition = serializers.CharField(max_length=1024, required=False, allow_blank=True)
    sync_mode = serializers.ChoiceField(choices=["full", "incremental"], required=False, default="full")
    watermark_strategy = serializers.CharField(required=False, allow_blank=True)
    watermark_field = serializers.CharField(max_length=64, required=False, allow_blank=True)
    schedule_type = serializers.ChoiceField(
        choices=["manual", "cron", "event", "webhook"], required=False, default="manual",
    )
    schedule_cron = serializers.CharField(max_length=64, required=False, allow_blank=True)
    batch_size = serializers.IntegerField(required=False, default=1000, min_value=1, max_value=100000)
    concurrency = serializers.IntegerField(required=False, default=1, min_value=1, max_value=32)
    retry_count = serializers.IntegerField(required=False, default=3, min_value=0, max_value=10)
    retry_interval = serializers.IntegerField(required=False, default=60, min_value=0, max_value=86400)
    write_mode = serializers.CharField(required=False)
    match_keys = serializers.ListField(required=False)
    conflict_strategy = serializers.CharField(required=False)
    conflict_compare_field = serializers.CharField(required=False, allow_blank=True)
    # 软删除信号：incoming 记录命中该 field=value 时触发 target delete
    soft_delete_field = serializers.CharField(max_length=64, required=False, allow_blank=True)
    soft_delete_value = serializers.CharField(max_length=64, required=False, allow_blank=True)
    sensitive_fields = serializers.ListField(required=False)
    desensitize_mode = serializers.CharField(required=False)
    enable_change_audit = serializers.BooleanField(required=False)
    enable_version_snapshot = serializers.BooleanField(required=False)
    version_retention_days = serializers.IntegerField(required=False)
    template_type = serializers.CharField(required=False)
    callback_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    webhook_secret = serializers.CharField(max_length=128, required=False, allow_blank=True)
    alert_email = serializers.CharField(max_length=255, required=False, allow_blank=True)
    alert_webhook_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    dag_steps = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    sync_direction = serializers.ChoiceField(
        choices=["forward", "reverse", "bidirectional"], required=False, default="forward",
    )
    origin_marker_field = serializers.CharField(max_length=64, required=False, allow_blank=True)
    origin_system_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    pair_job_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    environment = serializers.CharField(max_length=16, required=False, allow_blank=True)
    workspace_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    client_id = serializers.CharField(max_length=32, required=False, allow_blank=True)


class UpdateJobSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=128, required=False)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    source_datasource_id = serializers.CharField(max_length=64, required=False)
    target_datasource_id = serializers.CharField(max_length=64, required=False)
    source_config = serializers.DictField(required=False)
    target_config = serializers.DictField(required=False)
    field_mapping = serializers.ListField(child=serializers.DictField(), required=False)
    filter_condition = serializers.CharField(max_length=1024, required=False, allow_blank=True)
    sync_mode = serializers.ChoiceField(choices=["full", "incremental"], required=False)
    watermark_strategy = serializers.CharField(required=False, allow_blank=True)
    watermark_field = serializers.CharField(max_length=64, required=False, allow_blank=True)
    schedule_type = serializers.ChoiceField(choices=["manual", "cron", "event", "webhook"], required=False)
    schedule_cron = serializers.CharField(max_length=64, required=False, allow_blank=True)
    batch_size = serializers.IntegerField(required=False, min_value=1, max_value=100000)
    concurrency = serializers.IntegerField(required=False, min_value=1, max_value=32)
    retry_count = serializers.IntegerField(required=False, min_value=0, max_value=10)
    retry_interval = serializers.IntegerField(required=False, min_value=0, max_value=86400)
    write_mode = serializers.CharField(required=False)
    match_keys = serializers.ListField(required=False)
    conflict_strategy = serializers.CharField(required=False)
    conflict_compare_field = serializers.CharField(required=False, allow_blank=True)
    # 软删除信号：incoming 记录命中该 field=value 时触发 target delete
    soft_delete_field = serializers.CharField(max_length=64, required=False, allow_blank=True)
    soft_delete_value = serializers.CharField(max_length=64, required=False, allow_blank=True)
    sensitive_fields = serializers.ListField(required=False)
    desensitize_mode = serializers.CharField(required=False)
    enable_change_audit = serializers.BooleanField(required=False)
    enable_version_snapshot = serializers.BooleanField(required=False)
    version_retention_days = serializers.IntegerField(required=False)
    template_type = serializers.CharField(required=False)
    callback_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    webhook_secret = serializers.CharField(max_length=128, required=False, allow_blank=True)
    alert_email = serializers.CharField(max_length=255, required=False, allow_blank=True)
    alert_webhook_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    dag_steps = serializers.ListField(child=serializers.DictField(), required=False)
    sync_direction = serializers.ChoiceField(choices=["forward", "reverse", "bidirectional"], required=False)
    origin_marker_field = serializers.CharField(max_length=64, required=False, allow_blank=True)
    origin_system_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    pair_job_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    environment = serializers.CharField(max_length=16, required=False, allow_blank=True)
    workspace_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    client_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=["running", "stopped", "paused", "error"], required=False)
