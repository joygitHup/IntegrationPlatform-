"""集成任务 CRUD、手动触发、启停。"""
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import audit_from_request
from core.env import query_environment
from core.exceptions import ApiError
from core.permissions import HasPermission, IsAuthenticated
from core.query import q, q_int
from core.tenancy import get_owned, principal_client_id
from executions.services import enqueue_execution
from jobs.models import IntegrationJob
from jobs.serializers import CreateJobSerializer, JobSerializer, UpdateJobSerializer
from jobs.services import create_job, list_jobs, reset_job_watermark, set_job_status, update_job
from open_api.partner import apply_create_context


class JobListView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_read_permission = "job:read"
    required_write_permission = "job:write"

    def get(self, request):
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = list_jobs(
            keyword=q(request, "keyword"),
            status=q(request, "status"),
            sync_mode=q(request, "syncMode", "sync_mode"),
            source_datasource_id=q(request, "sourceDatasourceId", "source_datasource_id"),
            target_datasource_id=q(request, "targetDatasourceId", "target_datasource_id"),
            client_id=principal_client_id(request),
            environment=query_environment(request),
            workspace_id=q(request, "workspaceId", "workspace_id") or (request.META.get("HTTP_X_WORKSPACE_ID") or "").strip(),
        )
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": JobSerializer(items, many=True).data,
            "total": total,
            "page": page,
            "pageSize": page_size,
        })

    def post(self, request):
        ser = CreateJobSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        job = create_job(apply_create_context(request, ser.validated_data), created_by=request.auth_ctx.user_id)
        audit_from_request(
            request, action="CREATE", resource_type="JOB",
            resource_id=job.id, resource_name=job.name,
            detail={"code": job.code, "syncMode": job.sync_mode},
        )
        return Response(JobSerializer(job).data)


class JobDetailView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_read_permission = "job:read"
    required_write_permission = "job:write"

    def get(self, request, id: str):
        job = get_owned(IntegrationJob, id, request, not_found="任务不存在")
        return Response(JobSerializer(job).data)

    def put(self, request, id: str):
        get_owned(IntegrationJob, id, request, not_found="任务不存在")
        ser = UpdateJobSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        job = update_job(id, ser.validated_data)
        if not job:
            raise ApiError("任务不存在", 404)
        audit_from_request(
            request, action="UPDATE", resource_type="JOB",
            resource_id=id, resource_name=job.name,
            detail={"updatedFields": list(request.data.keys())},
        )
        return Response(JobSerializer(job).data)

    def delete(self, request, id: str):
        job = get_owned(IntegrationJob, id, request, not_found="任务不存在")
        job.delete()
        audit_from_request(request, action="DELETE", resource_type="JOB", resource_id=id, resource_name=job.name)
        return Response({"success": True})


class JobTriggerView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "job:execute"

    def post(self, request):
        job_id = request.data.get("jobId") or request.data.get("job_id")
        if not job_id:
            raise ApiError("缺少 jobId 参数", 400)
        job = get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        queued = enqueue_execution(job, trigger_type="manual", triggered_by=request.auth_ctx.user_id)
        audit_from_request(
            request, action="EXECUTE", resource_type="JOB",
            resource_id=job_id, resource_name=job.name,
            detail={**queued, "triggerType": "manual"},
        )
        return Response(queued)


class JobControlView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "job:write"

    def post(self, request):
        job_id = request.data.get("jobId") or request.data.get("job_id")
        action = request.data.get("action")
        if not job_id or not action:
            raise ApiError("缺少参数", 400)
        mapping = {"start": "running", "stop": "stopped", "pause": "paused"}
        if action not in mapping:
            raise ApiError(f"不支持的操作: {action}", 400)
        get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        job = set_job_status(job_id, mapping[action])
        audit_from_request(
            request, action="UPDATE", resource_type="JOB",
            resource_id=job_id, resource_name=job.name,
            detail={"statusChange": action},
        )
        return Response(JobSerializer(job).data)


class JobPreviewView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "job:read"

    def post(self, request):
        from datasources.models import Datasource
        from jobs.services import preview_mapping

        ds_id = request.data.get("datasourceId") or request.data.get("datasource_id") or request.data.get("sourceDatasourceId") or request.data.get("source_datasource_id")
        if not ds_id:
            raise ApiError("缺少 datasourceId", 400, code="VALIDATION")
        # 预览会真实抽取源数据：数据源必须归属当前主体
        ds = get_owned(Datasource, ds_id, request, not_found="数据源不存在")
        table = request.data.get("table") or (request.data.get("sourceConfig") or {}).get("table") or ""
        source_config = request.data.get("sourceConfig") or request.data.get("source_config") or {}
        if table:
            source_config = {**source_config, "table": table, "path": table}
        return Response(preview_mapping(
            datasource=ds,
            source_config=source_config,
            field_mapping=request.data.get("fieldMapping") or request.data.get("field_mapping") or [],
            filter_condition=request.data.get("filterCondition") or request.data.get("filter_condition") or "",
            limit=int(request.data.get("limit") or 20),
        ))


class JobResetWatermarkView(APIView):
    """手动设置 / 清空水位线。

    POST /api/jobs/<id>/reset-watermark  {"watermarkValue": "2025-10-20 00:00:00"}
    watermarkValue 为空或不传时 → 清空（下次跑等价全量）
    """

    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "job:write"

    def post(self, request, id: str):
        get_owned(IntegrationJob, id, request, not_found="任务不存在")
        # CamelCaseJSONParser 已把 camelCase 转成 snake_case，需读 watermark_value
        data = request.data if isinstance(request.data, dict) else {}
        new_value = data.get("watermark_value")
        if new_value is None:
            new_value = data.get("watermarkValue")
        job = reset_job_watermark(id, new_value=new_value)
        audit_from_request(
            request, action="UPDATE", resource_type="JOB",
            resource_id=id, resource_name=job.name,
            detail={
                "field": "watermarkValue",
                "newValue": job.watermark_value or "(cleared)",
            },
        )
        return Response(JobSerializer(job).data)
