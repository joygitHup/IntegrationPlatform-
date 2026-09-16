"""请求上下文：注入 traceId，供审计使用。"""
from __future__ import annotations

from core.ids import generate_trace_id


class StripTrailingSlashMiddleware:
    """API 无尾斜杠；浏览器/代理带上 / 时仍路由到同一视图，避免 POST 404。"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path_info or request.path
        if path.startswith("/admin"):
            return self.get_response(request)
        if len(path) > 1 and path.endswith("/"):
            request.path_info = path.rstrip("/") or "/"
        return self.get_response(request)


class RequestContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.META.get("HTTP_X_TRACE_ID"):
            request.META["HTTP_X_TRACE_ID"] = generate_trace_id()
        response = self.get_response(request)
        response["X-Environment"] = request.META.get("HTTP_X_ENVIRONMENT") or ""
        if not response.get("X-Environment"):
            from core.env import default_environment

            response["X-Environment"] = default_environment()
        ctx = getattr(request, "auth_ctx", None)
        client_id = ""
        if ctx is not None and 200 <= response.status_code < 400:
            client = getattr(ctx, "client", None)
            if client is not None:
                client_id = getattr(client, "id", "") or ""
            elif getattr(ctx, "user", None) is not None:
                client_id = getattr(ctx.user, "client_id", "") or ""
            else:
                client_id = getattr(ctx, "client_id", "") or ""
        # 计量全路径打点：客户主体（API Key / 客户账号）在 /api 下的所有成功业务调用
        if client_id:
            path = request.path_info or request.path or ""
            if path.startswith("/api") and not path.endswith(("/open/catalog", "/open/openapi.json", "/open/docs", "/open/errors", "/open/status", "/open/changelog")):
                from open_api.usage import bump

                bump(client_id, api_calls=1)
        return response
