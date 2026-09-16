from django.urls import path

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
    path("sso/validate", SsoValidateView.as_view()),
    path("sso/sessions", SsoSessionView.as_view()),
    path("sso/logs", SsoLogView.as_view()),
    path("sso/saml/metadata/<str:appId>", SamlMetadataView.as_view()),
    path("sso/saml/acs/<str:appId>", SamlAcsView.as_view()),
    path("sso/oauth2/<str:appId>/authorize", OAuthAuthorizeView.as_view()),
    path("sso/oauth2/<str:appId>/callback", OAuthCallbackView.as_view()),
    path("oauth/authorize", OAuthServerAuthorizeView.as_view()),
    path("oauth/token", OAuthServerTokenView.as_view()),
    path("oauth/userinfo", OAuthServerUserinfoView.as_view()),
]
