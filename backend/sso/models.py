"""SSO 应用、绑定、票据、会话、审计。"""
from __future__ import annotations

from django.db import models

from core.models import StringIdModel


class Application(StringIdModel):
    ID_PREFIX = "app"

    name = models.CharField(max_length=128)
    code = models.CharField(max_length=64, unique=True)
    description = models.CharField(max_length=500, blank=True, default="")
    icon = models.CharField(max_length=255, blank=True, default="")
    category = models.CharField(max_length=32, default="business")
    login_type = models.CharField(max_length=32, default="jwt")  # jwt / ticket / oauth2 / saml / form_based
    login_url = models.CharField(max_length=500, blank=True, default="")
    logout_url = models.CharField(max_length=500, blank=True, default="")
    callback_url = models.CharField(max_length=500, blank=True, default="")
    secret_key = models.CharField(max_length=500, blank=True, default="")
    settings = models.JSONField(default=dict, blank=True)
    jwt_algorithm = models.CharField(max_length=16, default="HS256")
    jwt_expires_in = models.IntegerField(default=30)
    ticket_expires_in = models.IntegerField(default=60)
    oauth_client_id = models.CharField(max_length=255, blank=True, default="")
    oauth_client_secret = models.CharField(max_length=500, blank=True, default="")
    oauth_auth_url = models.CharField(max_length=500, blank=True, default="")
    oauth_token_url = models.CharField(max_length=500, blank=True, default="")
    oauth_userinfo_url = models.CharField(max_length=500, blank=True, default="")
    oauth_scope = models.CharField(max_length=255, blank=True, default="")
    saml_idp_metadata_url = models.CharField(max_length=500, blank=True, default="")
    saml_sp_entity_id = models.CharField(max_length=255, blank=True, default="")
    saml_cert = models.CharField(max_length=2000, blank=True, default="")
    account_mapping = models.CharField(max_length=32, default="same_username")
    mapping_attribute = models.CharField(max_length=64, blank=True, default="")
    ip_whitelist_enabled = models.BooleanField(default=False)
    ip_whitelist = models.JSONField(default=list, blank=True)
    require_mfa = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    visible = models.BooleanField(default=True)
    status = models.CharField(max_length=16, default="active")
    created_by = models.CharField(max_length=32, blank=True, default="")
    client_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    workspace_id = models.CharField(max_length=32, blank=True, default="", db_index=True)
    environment = models.CharField(max_length=16, default="dev", db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_applications"


class UserAppBinding(StringIdModel):
    ID_PREFIX = "bind"

    user_id = models.CharField(max_length=32, db_index=True)
    app_id = models.CharField(max_length=32, db_index=True)
    external_user_id = models.CharField(max_length=128, blank=True, default="")
    external_username = models.CharField(max_length=128, blank=True, default="")
    encrypted_credentials = models.CharField(max_length=2000, blank=True, default="")
    status = models.CharField(max_length=16, default="active")
    last_login_at = models.DateTimeField(null=True, blank=True)
    login_count = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_user_app_bindings"


class SsoTicket(StringIdModel):
    ID_PREFIX = "ticket"

    ticket = models.CharField(max_length=64, unique=True)
    app_id = models.CharField(max_length=32)
    user_id = models.CharField(max_length=32)
    user_info = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, default="pending")
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    ip = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=500, blank=True, default="")
    consumed_ip = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        db_table = "sys_sso_tickets"


class SsoSession(StringIdModel):
    ID_PREFIX = "sso-sess"

    session_id = models.CharField(max_length=64, unique=True)
    app_id = models.CharField(max_length=32)
    user_id = models.CharField(max_length=32)
    username = models.CharField(max_length=64, blank=True, default="")
    login_type = models.CharField(max_length=32)
    external_session_id = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=16, default="active")
    login_at = models.DateTimeField()
    expires_at = models.DateTimeField(null=True, blank=True)
    logout_at = models.DateTimeField(null=True, blank=True)
    ip = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=500, blank=True, default="")
    logout_type = models.CharField(max_length=32, blank=True, default="")
    logout_reason = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "sys_sso_sessions"


class SsoAuditLog(StringIdModel):
    ID_PREFIX = "sso-log"

    app_id = models.CharField(max_length=32, blank=True, default="")
    app_name = models.CharField(max_length=128, blank=True, default="")
    user_id = models.CharField(max_length=32, blank=True, default="")
    username = models.CharField(max_length=64, blank=True, default="")
    event_type = models.CharField(max_length=32)
    login_type = models.CharField(max_length=32, blank=True, default="")
    result = models.CharField(max_length=16)
    failure_reason = models.CharField(max_length=255, blank=True, default="")
    detail = models.JSONField(default=dict, blank=True)
    ip = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=500, blank=True, default="")
    session_id = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        db_table = "sys_sso_audit_logs"
        indexes = [models.Index(fields=["created_at"], name="idx_sso_audit_created")]


class OAuthState(StringIdModel):
    """平台作为 OAuth 客户端时保存的 state / PKCE。"""
    ID_PREFIX = "oast"

    state = models.CharField(max_length=64, unique=True)
    app_id = models.CharField(max_length=32, db_index=True)
    user_id = models.CharField(max_length=32, blank=True, default="")
    redirect_uri = models.CharField(max_length=500, blank=True, default="")
    code_verifier = models.CharField(max_length=128, blank=True, default="")
    nonce = models.CharField(max_length=64, blank=True, default="")
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)

    class Meta:
        db_table = "sys_oauth_states"


class OAuthAuthorizationCode(StringIdModel):
    """平台作为 OAuth 授权服务器时签发的 code。"""
    ID_PREFIX = "oac"

    code = models.CharField(max_length=64, unique=True)
    app_id = models.CharField(max_length=32, db_index=True)
    user_id = models.CharField(max_length=32)
    redirect_uri = models.CharField(max_length=500, blank=True, default="")
    scope = models.CharField(max_length=255, blank=True, default="")
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)

    class Meta:
        db_table = "sys_oauth_codes"


class SsoAuthnRequest(StringIdModel):
    """发出的 SAML AuthnRequest，ACS 时校验 InResponseTo。"""
    ID_PREFIX = "samlreq"

    request_id = models.CharField(max_length=64, unique=True)
    app_id = models.CharField(max_length=32, db_index=True)
    relay_state = models.CharField(max_length=500, blank=True, default="")
    expires_at = models.DateTimeField()
    consumed = models.BooleanField(default=False)

    class Meta:
        db_table = "sys_saml_authn"

