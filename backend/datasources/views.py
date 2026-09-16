"""数据源与连接器 API。路径/字段与前端 datasourcesApi、connectorsApi 对齐。"""
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import audit_from_request
from core.env import query_environment
from core.exceptions import ApiError
from core.permissions import HasPermission, IsAuthenticated
from core.query import q, q_int
from core.tenancy import get_owned, principal_client_id
from datasources.connectors.registry import get_connector, list_connectors
from datasources.models import Datasource
from datasources.serializers import (
    CreateDatasourceSerializer,
    TestConnectionSerializer,
    UpdateDatasourceSerializer,
)
from datasources.services import (
    create_datasource,
    decrypt_config,
    list_datasources,
    serialize_ds,
    test_and_save,
    update_datasource,
)
from open_api.partner import apply_create_context


class DatasourceListView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_read_permission = "datasource:read"
    required_write_permission = "datasource:write"

    def get(self, request):
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = list_datasources(
            keyword=q(request, "keyword"),
            type=q(request, "type"),
            types=q(request, "types"),
            status=q(request, "status"),
            client_id=principal_client_id(request),
            environment=query_environment(request),
            workspace_id=q(request, "workspaceId", "workspace_id") or (request.META.get("HTTP_X_WORKSPACE_ID") or "").strip(),
        )
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": [serialize_ds(d) for d in items],
            "total": total,
            "page": page,
            "pageSize": page_size,
        })

    def post(self, request):
        ser = CreateDatasourceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ds = create_datasource(apply_create_context(request, ser.validated_data), created_by=request.auth_ctx.user_id)
        audit_from_request(
            request, action="CREATE", resource_type="DATASOURCE",
            resource_id=ds.id, resource_name=ds.name,
            detail={"type": ds.type, "code": ds.code},
        )
        return Response(serialize_ds(ds))


class DatasourceDetailView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_read_permission = "datasource:read"
    required_write_permission = "datasource:write"

    def get(self, request, id: str):
        ds = get_owned(Datasource, id, request, not_found="数据源不存在")
        return Response(serialize_ds(ds))

    def put(self, request, id: str):
        get_owned(Datasource, id, request, not_found="数据源不存在")
        ser = UpdateDatasourceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ds = update_datasource(id, ser.validated_data)
        if not ds:
            raise ApiError("数据源不存在", 404)
        audit_from_request(
            request, action="UPDATE", resource_type="DATASOURCE",
            resource_id=id, resource_name=ds.name,
            detail={"updatedFields": list(ser.validated_data.keys())},
        )
        return Response(serialize_ds(ds))

    def delete(self, request, id: str):
        ds = get_owned(Datasource, id, request, not_found="数据源不存在")
        ds.delete()
        audit_from_request(
            request, action="DELETE", resource_type="DATASOURCE",
            resource_id=id, resource_name=ds.name, detail={"type": ds.type},
        )
        return Response({"success": True})


class DatasourceTestView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "datasource:read"

    def post(self, request):
        ds_id = request.query_params.get("id") or request.data.get("id")
        if ds_id and not (request.data.get("type") and request.data.get("config")):
            ds = get_owned(Datasource, ds_id, request, not_found="数据源不存在")
            config = decrypt_config(ds.type, ds.config if isinstance(ds.config, dict) else {})
            return Response(test_and_save(ds, ds.type, config))

        ser = TestConnectionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        type_name = ser.validated_data["type"]
        config = ser.validated_data.get("config") or {}
        ds = None
        if ds_id:
            # 引用已存数据源做测连时同样要校验归属
            ds = get_owned(Datasource, ds_id, request, not_found="数据源不存在")
        return Response(test_and_save(ds, type_name, config))


class DatasourceInspectView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "datasource:read"

    def post(self, request):
        from datasources.services import inspect_datasource

        ds_id = request.data.get("id") or request.data.get("datasourceId") or request.query_params.get("id")
        if not ds_id:
            raise ApiError("缺少数据源 id", 400, code="VALIDATION")
        ds = get_owned(Datasource, ds_id, request, not_found="数据源不存在")
        table = request.data.get("table") or request.data.get("path") or ""
        return Response(inspect_datasource(ds, table=str(table or "")))


class ConnectorListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(list_connectors(
            category=q(request, "category"),
            capability=q(request, "capability"),
        ))


class ConnectorDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, type: str):
        c = get_connector(type)
        if not c:
            raise ApiError("连接器不存在", 404)
        return Response(c.metadata())
