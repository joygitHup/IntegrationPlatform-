from django.urls import include, path

urlpatterns = [
    path("", include("iam.urls")),
    path("", include("datasources.urls")),
    path("", include("jobs.urls")),
    path("", include("executions.urls")),
    path("", include("sso.urls")),
    path("", include("org_sync.urls")),
    path("", include("audit.urls")),
    path("", include("monitor.urls")),
    path("", include("open_api.urls")),
]
