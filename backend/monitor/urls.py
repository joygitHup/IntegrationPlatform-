from django.urls import path

from monitor.views import DashboardStatsView, EnvironmentView, MetricsView

urlpatterns = [
    path("dashboard/stats", DashboardStatsView.as_view()),
    path("metrics", MetricsView.as_view()),
    path("system/env", EnvironmentView.as_view()),
]
