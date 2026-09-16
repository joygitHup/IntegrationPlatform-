from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.models import AuditLog
from core.permissions import HasPermission, IsAuthenticated
from core.query import q, q_int
from core.tenancy import scope_qs


def _iso(value):
    return value.isoformat() if value else None


def serialize_audit(log: AuditLog) -> dict:
    return {
        "id": log.id,
        "userId": log.user_id,
        "username": log.username,
        "clientId": log.client_id or "",
        "action": log.action,
        "resourceType": log.resource_type,
        "resourceId": log.resource_id,
        "resourceName": log.resource_name,
        "detail": log.detail,
        "ip": log.ip,
        "userAgent": log.user_agent,
        "traceId": log.trace_id,
        "createdAt": _iso(log.created_at),
    }


class AuditLogListView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "audit:read"

    def get(self, request):
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = scope_qs(AuditLog.objects.all(), request).order_by("-created_at")
        if q(request, "clientId", "client_id"):
            qs = qs.filter(client_id=q(request, "clientId", "client_id"))
        if q(request, "userId", "user_id"):
            qs = qs.filter(user_id=q(request, "userId", "user_id"))
        if q(request, "action"):
            qs = qs.filter(action=q(request, "action"))
        if q(request, "resourceType", "resource_type"):
            qs = qs.filter(resource_type=q(request, "resourceType", "resource_type"))
        if q(request, "resourceId", "resource_id"):
            qs = qs.filter(resource_id=q(request, "resourceId", "resource_id"))
        keyword = q(request, "keyword")
        if keyword:
            qs = qs.filter(
                Q(username__icontains=keyword)
                | Q(resource_id__icontains=keyword)
                | Q(resource_name__icontains=keyword)
                | Q(ip__icontains=keyword)
            )
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": [serialize_audit(i) for i in items],
            "total": total,
            "page": page,
            "pageSize": page_size,
        })
