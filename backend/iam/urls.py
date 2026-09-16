from django.urls import path

from iam.views import (
    LoginView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PasswordView,
    RefreshView,
    RoleDetailView,
    RoleListView,
    SeedView,
    UserDetailView,
    UserListView,
)

urlpatterns = [
    path("auth/login", LoginView.as_view()),
    path("auth/logout", LogoutView.as_view()),
    path("auth/refresh", RefreshView.as_view()),
    path("auth/me", MeView.as_view()),
    path("auth/password", PasswordView.as_view()),
    path("auth/password/reset/request", PasswordResetRequestView.as_view()),
    path("auth/password/reset/confirm", PasswordResetConfirmView.as_view()),
    path("users", UserListView.as_view()),
    path("users/<str:id>", UserDetailView.as_view()),
    path("roles", RoleListView.as_view()),
    path("roles/<str:id>", RoleDetailView.as_view()),
    path("system/seed", SeedView.as_view()),
]
