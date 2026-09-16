"""数据源序列化。对外字段经 camelCase 渲染后与前端对齐。"""
from rest_framework import serializers

from datasources.models import Datasource


class DatasourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Datasource
        fields = [
            "id", "name", "code", "type", "config", "description", "status",
            "last_test_status", "last_test_at", "last_test_error",
            "created_by", "created_at", "updated_at", "environment", "workspace_id", "client_id",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "created_by"]


class CreateDatasourceSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=128)
    code = serializers.RegexField(
        r"^[a-zA-Z][a-zA-Z0-9_-]*$",
        max_length=64,
        error_messages={"invalid": "编码只能以字母开头，可包含字母、数字、下划线和中划线"},
    )
    type = serializers.CharField(max_length=32)
    config = serializers.DictField(required=False, default=dict)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=["active", "disabled"], required=False, default="active")
    environment = serializers.CharField(max_length=16, required=False, allow_blank=True)
    workspace_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    client_id = serializers.CharField(max_length=32, required=False, allow_blank=True)


class UpdateDatasourceSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=128, required=False)
    type = serializers.CharField(max_length=32, required=False)
    config = serializers.DictField(required=False)
    description = serializers.CharField(max_length=255, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=["active", "disabled"], required=False)
    environment = serializers.CharField(max_length=16, required=False, allow_blank=True)
    workspace_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    client_id = serializers.CharField(max_length=32, required=False, allow_blank=True)


class TestConnectionSerializer(serializers.Serializer):
    type = serializers.CharField()
    config = serializers.DictField(required=False, default=dict)
    id = serializers.CharField(required=False, allow_blank=True)
