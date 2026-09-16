from rest_framework import serializers

from sso.app_utils import APP_CODE_PATTERN, CATEGORIES, LOGIN_TYPES
from sso.models import Application, SsoAuditLog, SsoSession, UserAppBinding


class ApplicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Application
        exclude = ["secret_key", "oauth_client_secret", "saml_cert"]
        read_only_fields = ["id", "created_at", "updated_at", "created_by"]


class BindingSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserAppBinding
        exclude = ["encrypted_credentials"]


class SessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SsoSession
        fields = "__all__"


class SsoLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SsoAuditLog
        fields = "__all__"


class CreateAppSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=128)
    code = serializers.RegexField(
        APP_CODE_PATTERN,
        max_length=64,
        error_messages={"invalid": "编码只能以字母开头，可包含字母、数字、下划线和中划线"},
    )
    description = serializers.CharField(max_length=500, required=False, allow_blank=True)
    icon = serializers.CharField(max_length=255, required=False, allow_blank=True)
    category = serializers.ChoiceField(choices=CATEGORIES, required=False, default="business")
    login_type = serializers.ChoiceField(choices=LOGIN_TYPES, required=False, default="jwt")
    login_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    logout_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    callback_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    settings = serializers.DictField(required=False)
    jwt_algorithm = serializers.CharField(required=False, allow_blank=True)
    jwt_expires_in = serializers.IntegerField(required=False, min_value=1, max_value=86400)
    ticket_expires_in = serializers.IntegerField(required=False, min_value=1, max_value=86400)
    oauth_client_id = serializers.CharField(required=False, allow_blank=True)
    oauth_client_secret = serializers.CharField(required=False, allow_blank=True)
    oauth_auth_url = serializers.CharField(required=False, allow_blank=True)
    oauth_token_url = serializers.CharField(required=False, allow_blank=True)
    oauth_userinfo_url = serializers.CharField(required=False, allow_blank=True)
    oauth_scope = serializers.CharField(required=False, allow_blank=True)
    saml_idp_metadata_url = serializers.CharField(required=False, allow_blank=True)
    saml_sp_entity_id = serializers.CharField(required=False, allow_blank=True)
    saml_cert = serializers.CharField(required=False, allow_blank=True)
    account_mapping = serializers.CharField(required=False, allow_blank=True)
    mapping_attribute = serializers.CharField(required=False, allow_blank=True)
    sort_order = serializers.IntegerField(required=False, default=0)
    visible = serializers.BooleanField(required=False, default=True)
    status = serializers.ChoiceField(choices=["active", "disabled"], required=False, default="active")
    environment = serializers.CharField(max_length=16, required=False, allow_blank=True)
    workspace_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    client_id = serializers.CharField(max_length=32, required=False, allow_blank=True)


class UpdateAppSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=128, required=False)
    description = serializers.CharField(max_length=500, required=False, allow_blank=True)
    icon = serializers.CharField(max_length=255, required=False, allow_blank=True)
    category = serializers.ChoiceField(choices=CATEGORIES, required=False)
    login_type = serializers.ChoiceField(choices=LOGIN_TYPES, required=False)
    login_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    logout_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    callback_url = serializers.CharField(max_length=500, required=False, allow_blank=True)
    settings = serializers.DictField(required=False)
    jwt_algorithm = serializers.CharField(required=False, allow_blank=True)
    jwt_expires_in = serializers.IntegerField(required=False, min_value=1, max_value=86400)
    ticket_expires_in = serializers.IntegerField(required=False, min_value=1, max_value=86400)
    oauth_client_id = serializers.CharField(required=False, allow_blank=True)
    oauth_client_secret = serializers.CharField(required=False, allow_blank=True)
    oauth_auth_url = serializers.CharField(required=False, allow_blank=True)
    oauth_token_url = serializers.CharField(required=False, allow_blank=True)
    oauth_userinfo_url = serializers.CharField(required=False, allow_blank=True)
    oauth_scope = serializers.CharField(required=False, allow_blank=True)
    saml_idp_metadata_url = serializers.CharField(required=False, allow_blank=True)
    saml_sp_entity_id = serializers.CharField(required=False, allow_blank=True)
    saml_cert = serializers.CharField(required=False, allow_blank=True)
    account_mapping = serializers.CharField(required=False, allow_blank=True)
    mapping_attribute = serializers.CharField(required=False, allow_blank=True)
    sort_order = serializers.IntegerField(required=False)
    visible = serializers.BooleanField(required=False)
    status = serializers.ChoiceField(choices=["active", "disabled"], required=False)
    environment = serializers.CharField(max_length=16, required=False, allow_blank=True)
    workspace_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
    client_id = serializers.CharField(max_length=32, required=False, allow_blank=True)
