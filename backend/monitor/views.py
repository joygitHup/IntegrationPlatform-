"""仪表盘统计，字段与前端 dashboardApi.stats 对齐。"""
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.env import query_environment
from core.exceptions import ApiError
from core.permissions import IsAuthenticated, has_permission
from core.tenancy import principal_client_id
from monitor.services import collect_dashboard_stats
from open_api.partner import request_workspace_id


class DashboardStatsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        auth = getattr(request, "auth_ctx", None)
        if not any(has_permission(auth, p) for p in ("execution:read", "job:read", "datasource:read")):
            raise ApiError("权限不足", 403)
        return Response(collect_dashboard_stats(
            environment=query_environment(request),
            workspace_id=request_workspace_id(request),
            client_id=principal_client_id(request),
        ))


class MetricsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from django.http import HttpResponse
        from monitor.metrics import render_metrics

        body, content_type = render_metrics()
        return HttpResponse(body, content_type=content_type)


class EnvironmentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from core.env import default_environment, request_environment
        from django.conf import settings

        return Response({
            "environment": request_environment(request),
            "defaultEnvironment": default_environment(),
            "queueBackend": getattr(settings, "QUEUE_BACKEND", "memory"),
            "publicBaseUrl": getattr(settings, "PUBLIC_BASE_URL", ""),
        })
