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
    """Prometheus 指标出口。

    生产环境务必配置环境变量 METRICS_TOKEN，此时要求
    `Authorization: Bearer <token>` 或 `?token=<token>`；
    未配置（开发态默认）保持匿名可访问，避免挡掉本地 Prometheus 抓取。
    """

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from django.conf import settings
        from django.http import HttpResponse
        from monitor.metrics import render_metrics

        token = getattr(settings, "METRICS_TOKEN", "") or ""
        if token:
            auth = request.headers.get("Authorization", "")
            provided = auth[7:] if auth.startswith("Bearer ") else request.GET.get("token", "")
            if provided != token:
                raise ApiError("无效的 metrics 访问令牌", 401)
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
