from django.urls import path

from sso.jwks import JwksView
from sso.oidc import OidcDiscoveryView
from sso.views import (
    AppDetailView,
    AppListView,
    BindingView,
    MyAppsView,
    OAuthAuthorizeView,
    OAuthCallbackView,
    OAuthServerAuthorizeView,
    OAuthServerTokenView,
    OAuthServerUserinfoView,
    SamlAcsView,
    SamlMetadataView,
    SsoLaunchView,
    SsoLoginView,
    SsoLogView,
    SsoRedirectView,
    SsoSessionView,
    SsoValidateView,
)

urlpatterns = [
    path("apps", AppListView.as_view()),
    path("apps/my", MyAppsView.as_view()),
    path("apps/bindings", BindingView.as_view()),
    path("apps/<str:id>", AppDetailView.as_view()),
    path("sso/login", SsoLoginView.as_view()),
    path("sso/launch", SsoLaunchView.as_view()),
    path("sso/redirect", SsoRedirectView.as_view()),  # P1 跳板模式（A 用中台 JWT 调用）
    path("sso/validate", SsoValidateView.as_view()),
    path("sso/sessions", SsoSessionView.as_view()),
    path("sso/logs", SsoLogView.as_view()),
    # P0 JWKS 公钥公开（B 系统 SDK 拉公钥自动验签）
    path("sso/.well-known/jwks.json", JwksView.as_view()),
    # P2 OIDC 发现文档（A/B 系统用标准 OAuth2 库接入）
    path("sso/.well-known/openid-configuration", OidcDiscoveryView.as_view()),
    path("sso/saml/metadata/<str:appId>", SamlMetadataView.as_view()),
    path("sso/saml/acs/<str:appId>", SamlAcsView.as_view()),
    path("sso/oauth2/<str:appId>/authorize", OAuthAuthorizeView.as_view()),
    path("sso/oauth2/<str:appId>/callback", OAuthCallbackView.as_view()),
    path("oauth/authorize", OAuthServerAuthorizeView.as_view()),
    path("oauth/token", OAuthServerTokenView.as_view()),
    path("oauth/userinfo", OAuthServerUserinfoView.as_view()),
]
