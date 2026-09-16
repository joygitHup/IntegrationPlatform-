"""开放集成服务：目录、凭证、应用 / 数据源 / 任务门面。"""
from __future__ import annotations

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import audit_from_request
from core.authentication import JWTAuthentication
from core.exceptions import ApiError
from core.permissions import IsAuthenticated, has_permission
from core.query import q, q_int
from core.tenancy import assert_object_owned, assert_platform, principal_client_id
from datasources.connectors.registry import get_connector, list_connectors, test_connection
from datasources.models import Datasource
from datasources.serializers import CreateDatasourceSerializer, TestConnectionSerializer
from datasources.services import create_datasource, decrypt_config, inspect_datasource, list_datasources, serialize_ds
from executions.models import DataVersionSnapshot
from executions.services import enqueue_execution, execute_snapshot_rollback, jobs_map, list_executions, serialize_execution
from jobs.models import IntegrationJob
from jobs.serializers import CreateJobSerializer, JobSerializer
from jobs.services import create_job, list_jobs, preview_mapping, promote_job, assert_accepts_push
from open_api.auth import ApiKeyAuthentication, generate_api_key, hash_api_key, require_scope
from open_api.catalog import DEFAULT_SCOPES, build_catalog
from open_api.errors import CHANGELOG, ERROR_CATALOG
from open_api.idempotency import replay_response, store_response
from open_api.models import IntegrationClient, PartnerWorkspace
from open_api.partner import (
    apply_create_context,
    create_workspace,
    ensure_default_workspace,
    ensure_platform_workspace,
    request_workspace_id,
    serialize_workspace,
)
from open_api.spec import build_openapi
from open_api.usage import usage_payload
from org_sync.identity import IdentityError, pull_identity
from org_sync.services import sync_org_from_source, sync_user_departments
from org_sync.templates import TEMPLATES
from sso.engine import get_app, launch_cross_app_sso
from sso.serializers import ApplicationSerializer, CreateAppSerializer
from sso.services import create_app, list_apps


def _actor_id(request) -> str:
    ctx = getattr(request, "auth_ctx", None)
    return getattr(ctx, "user_id", "") if ctx else ""


def _owner_kw(request) -> dict:
    cid = principal_client_id(request)
    return {"client_id": cid} if cid else {}


def _scope_kw(request) -> dict:
    kw = {}
    cid = principal_client_id(request)
    if cid:
        kw["client_id"] = cid
    ws = request_workspace_id(request)
    if ws:
        kw["workspace_id"] = ws
    return kw


class CatalogView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(build_catalog())


class ConnectorCatalogView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        category = q(request, "category")
        items = list_connectors(category=category)
        type_name = q(request, "type")
        if type_name:
            conn = get_connector(type_name)
            if not conn:
                raise ApiError("连接器不存在", 404)
            return Response(conn.metadata())
        return Response({"items": items, "total": len(items)})


class TemplateCatalogView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"items": TEMPLATES, "total": len(TEMPLATES)})


class OpenAuthMixin:
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]
    permission_classes = [IsAuthenticated]


class OpenAppView(OpenAuthMixin, APIView):
    def get(self, request):
        require_scope(request, "app:read")
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = list_apps(keyword=q(request, "keyword"), status=q(request, "status"), **_scope_kw(request))
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": ApplicationSerializer(items, many=True).data,
            "total": total, "page": page, "pageSize": page_size,
        })

    def post(self, request):
        require_scope(request, "app:write")
        ser = CreateAppSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        app, secret = create_app(apply_create_context(request, ser.validated_data), created_by=_actor_id(request))
        audit_from_request(
            request, action="CREATE", resource_type="APP",
            resource_id=app.id, resource_name=app.name,
            detail={"via": "open"},
        )
        data = ApplicationSerializer(app).data
        data["secretKey"] = secret
        return Response(data)


class OpenDatasourceView(OpenAuthMixin, APIView):
    def get(self, request):
        require_scope(request, "datasource:read")
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = list_datasources(keyword=q(request, "keyword"), type=q(request, "type"), status=q(request, "status"), **_scope_kw(request))
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": [serialize_ds(i) for i in items],
            "total": total, "page": page, "pageSize": page_size,
        })

    def post(self, request):
        require_scope(request, "datasource:write")
        ser = CreateDatasourceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ds = create_datasource(apply_create_context(request, ser.validated_data), created_by=_actor_id(request))
        audit_from_request(
            request, action="CREATE", resource_type="DATASOURCE",
            resource_id=ds.id, resource_name=ds.name,
            detail={"via": "open"},
        )
        return Response(serialize_ds(ds))


class OpenDatasourceTestView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "datasource:write", "datasource:read")
        ser = TestConnectionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        return Response(test_connection(ser.validated_data["type"], ser.validated_data.get("config") or {}))


class OpenJobView(OpenAuthMixin, APIView):
    def get(self, request):
        require_scope(request, "job:read")
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = list_jobs(keyword=q(request, "keyword"), status=q(request, "status"), **_scope_kw(request))
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": JobSerializer(items, many=True).data,
            "total": total, "page": page, "pageSize": page_size,
        })

    def post(self, request):
        require_scope(request, "job:write")
        ser = CreateJobSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        job = create_job(apply_create_context(request, ser.validated_data), created_by=_actor_id(request))
        audit_from_request(
            request, action="CREATE", resource_type="JOB",
            resource_id=job.id, resource_name=job.name,
            detail={"via": "open"},
        )
        return Response(JobSerializer(job).data)


class OpenJobTriggerView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "job:execute")
        job_id = request.data.get("jobId") or request.data.get("job_id") or request.data.get("code")
        if not job_id:
            raise ApiError("缺少 jobId", 400)
        job = IntegrationJob.objects.filter(id=job_id).first() or IntegrationJob.objects.filter(code=job_id).first()
        if not job:
            raise ApiError("任务不存在", 404)
        assert_object_owned(job, request, not_found="任务不存在")
        actor = _actor_id(request)
        queued = enqueue_execution(job, trigger_type="manual", triggered_by=actor)
        audit_from_request(
            request, action="EXECUTE", resource_type="JOB",
            resource_id=job.id, resource_name=job.name,
            detail={"executionId": queued["executionId"], "via": "open"},
        )
        return Response(queued)


class OpenExecutionView(OpenAuthMixin, APIView):
    def get(self, request):
        require_scope(request, "execution:read")
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = list_executions(
            job_id=q(request, "jobId", "job_id"),
            status=q(request, "status"),
            trigger_type=q(request, "triggerType", "trigger_type"),
            keyword=q(request, "keyword"),
            **_owner_kw(request),
        )
        total = qs.count()
        items = list(qs[(page - 1) * page_size : page * page_size])
        jobs = jobs_map(e.job_id for e in items)
        return Response({
            "items": [serialize_execution(e, jobs.get(e.job_id)) for e in items],
            "total": total, "page": page, "pageSize": page_size,
        })


class OpenLaunchView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "sso:launch")
        data = request.data
        source = data.get("from") or data.get("sourceApp") or data.get("sourceAppId")
        target = data.get("to") or data.get("targetApp") or data.get("targetAppId")
        token = data.get("token")
        if not source or not target:
            raise ApiError("缺少 from / to", 400)
        source_app = get_app(str(source))
        target_app = get_app(str(target))
        if not source_app or not target_app:
            raise ApiError("应用不存在", 404, code="NOT_FOUND")
        assert_object_owned(source_app, request, not_found="应用不存在")
        assert_object_owned(target_app, request, not_found="应用不存在")
        result = launch_cross_app_sso(
            source_ref=str(source),
            target_ref=str(target),
            token=str(token or ""),
            redirect_path=data.get("redirectUrl") or "",
            ip=getattr(request.auth_ctx, "ip", ""),
            user_agent=getattr(request.auth_ctx, "user_agent", ""),
        )
        return Response(result)


class OpenApiSpecView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from django.http import JsonResponse

        return JsonResponse(build_openapi())


class OpenApiDocsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from django.http import HttpResponse

        html = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <title>集成中台开放服务</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: 'openapi.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>"""
        return HttpResponse(html)


def _records_from_body(data):
    if data is None or data == "":
        return None
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if not isinstance(data, dict):
        return None
    if data.get("trigger") is True:
        return None
    for key in ("records", "items", "data"):
        if isinstance(data.get(key), list):
            return [x for x in data[key] if isinstance(x, dict)]
    skip = {"jobId", "job_id", "code", "trigger", "from", "to"}
    if any(k not in skip for k in data.keys()):
        return [data]
    return None


def _load_job(ref: str) -> IntegrationJob:
    job = IntegrationJob.objects.filter(id=ref).first() or IntegrationJob.objects.filter(code=ref).first()
    if not job:
        raise ApiError("任务不存在", 404)
    return job


def _authorize_hook(request, job: IntegrationJob) -> str:
    import secrets as _secrets

    header = (request.META.get("HTTP_X_WEBHOOK_SECRET") or "").strip()
    expected = (job.webhook_secret or "").strip()
    if expected and header and _secrets.compare_digest(header, expected):
        return "webhook"
    if getattr(request, "auth_ctx", None):
        require_scope(request, "job:execute")
        return "apikey"
    raise ApiError("缺少有效的 Webhook Secret 或 API Key", 401)


class OpenIngestView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "job:execute")
        replay = replay_response(request, "/open/jobs/ingest")
        if replay:
            return replay
        ref = request.data.get("jobId") or request.data.get("job_id") or request.data.get("code")
        if not ref:
            raise ApiError("缺少 jobId", 400, code="VALIDATION")
        job = _load_job(str(ref))
        assert_object_owned(job, request, not_found="任务不存在")
        records = _records_from_body(request.data)
        if records is not None:
            assert_accepts_push(job)
        queued = enqueue_execution(
            job,
            trigger_type="webhook" if records is not None else "manual",
            triggered_by=_actor_id(request),
            payload=records,
        )
        store_response(request, "/open/jobs/ingest", queued)
        return Response(queued)


class OpenHookView(APIView):
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]
    permission_classes = [AllowAny]

    def post(self, request, code: str):
        replay = replay_response(request, f"/open/hooks/{code}")
        if replay:
            return replay
        job = _load_job(code)
        mode = _authorize_hook(request, job)
        if mode == "apikey":
            assert_object_owned(job, request, not_found="任务不存在")
        assert_accepts_push(job)
        records = _records_from_body(request.data)
        actor = _actor_id(request) or f"hook:{job.code}"
        queued = enqueue_execution(
            job,
            trigger_type="webhook",
            triggered_by=actor,
            payload=records,
        )
        store_response(request, f"/open/hooks/{code}", queued)
        return Response(queued)


class OpenIdentityPullView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "datasource:read", "job:execute", "job:write")
        ds_id = request.data.get("datasourceId") or request.data.get("datasource_id")
        if not ds_id:
            raise ApiError("缺少 datasourceId", 400)
        ds = Datasource.objects.filter(id=ds_id).first()
        if not ds:
            raise ApiError("数据源不存在", 404)
        assert_object_owned(ds, request, not_found="数据源不存在")
        try:
            result = pull_identity(ds.type, decrypt_config(ds.type, ds.config if isinstance(ds.config, dict) else {}))
        except IdentityError as exc:
            raise ApiError(str(exc), 400) from exc
        users = result.get("users") or []
        departments = result.get("departments") or []
        synced = None
        queued = None
        job_ref = request.data.get("jobId") or request.data.get("job_id") or request.data.get("code")
        job = None
        if job_ref:
            job = _load_job(str(job_ref))
            assert_object_owned(job, request, not_found="任务不存在")
            if request.data.get("syncOrg") is not False:
                synced = sync_org_from_source(job_id=job.id, departments=departments, mode="full")
                synced["userDepartments"] = sync_user_departments(
                    job_id=job.id, users=users, mode="full",
                )
            if request.data.get("executeJob"):
                queued = enqueue_execution(
                    job,
                    trigger_type="manual",
                    triggered_by=_actor_id(request),
                    payload=users,
                )
        sample = [{k: v for k, v in u.items() if k != "raw"} for u in users[:20]]
        return Response({
            "source": result.get("source"),
            "userCount": len(users),
            "departmentCount": len(departments),
            "users": sample,
            "departments": departments[:50],
            "orgSync": synced,
            "execution": queued,
        })


class OpenRollbackView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "job:execute")
        job_id = request.data.get("jobId") or request.data.get("job_id")
        if not job_id:
            raise ApiError("缺少 jobId", 400)
        job = _load_job(str(job_id))
        assert_object_owned(job, request, not_found="任务不存在")
        snapshot_id = request.data.get("snapshotId") or request.data.get("id")
        snap = None
        if snapshot_id:
            snap = DataVersionSnapshot.objects.filter(id=snapshot_id, job_id=job.id).first()
        else:
            snap = DataVersionSnapshot.objects.filter(
                job_id=job.id,
                version=request.data.get("targetVersion") or job.version,
                snapshot_type=request.data.get("snapshotType") or "before",
            ).first()
        if not snap:
            raise ApiError("快照不存在", 404)
        plan = {
            "jobId": job.id,
            "snapshotId": snap.id,
            "targetVersion": snap.version,
            "snapshotType": snap.snapshot_type,
            "recordCount": snap.record_count,
            "operations": [{"op": "restore", "count": snap.record_count}],
        }
        if not request.data.get("execute"):
            return Response({"plan": plan})
        result = execute_snapshot_rollback(job, snap, triggered_by=_actor_id(request))
        return Response({"plan": plan, "result": result})


def _serialize_client(client: IntegrationClient, *, api_key: str | None = None) -> dict:
    from open_api.entitlements import effective_limits

    limits = effective_limits(client.id) if client.id else {}
    data = {
        "id": client.id,
        "name": client.name,
        "code": client.code,
        "description": client.description,
        "keyPrefix": client.key_prefix,
        "scopes": client.scopes or [],
        "status": client.status,
        "callbackUrl": client.callback_url,
        "ipWhitelist": client.ip_whitelist or [],
        "rateLimitPerMinute": client.rate_limit_per_minute,
        "monthlyCallQuota": client.monthly_call_quota,
        "monthlyRowQuota": client.monthly_row_quota,
        "entitlement": {
            "maxJobs": limits.get("max_jobs", 0),
            "maxSeats": limits.get("max_seats", 0),
            "maxConnectors": limits.get("max_connectors", 0),
            "maxRowsMonthly": limits.get("max_rows_monthly", 0),
            "maxApiCallsMonthly": limits.get("max_api_calls_monthly", 0),
        },
        "sandbox": bool(client.sandbox),
        "alertEmail": client.alert_email,
        "alertWebhookUrl": client.alert_webhook_url,
        "lastUsedAt": client.last_used_at.isoformat() if client.last_used_at else None,
        "createdAt": client.created_at.isoformat() if client.created_at else None,
    }
    if api_key:
        data["apiKey"] = api_key
    return data


_ENTITLEMENT_FIELD_MAP = {
    "maxJobs": "max_jobs",
    "max_jobs": "max_jobs",
    "maxSeats": "max_seats",
    "max_seats": "max_seats",
    "maxConnectors": "max_connectors",
    "max_connectors": "max_connectors",
    "maxRowsMonthly": "max_rows_monthly",
    "max_rows_monthly": "max_rows_monthly",
    "maxApiCallsMonthly": "max_api_calls_monthly",
    "max_api_calls_monthly": "max_api_calls_monthly",
}


def _apply_entitlements(client_id: str, data: dict) -> None:
    """授权配额字段落表（全部 0=不限；未传任何字段则不动）。"""
    values: dict = {}
    nested = data.get("entitlement") if isinstance(data.get("entitlement"), dict) else None
    source = {**(nested or {}), **data}
    for raw_key, field in _ENTITLEMENT_FIELD_MAP.items():
        if raw_key in source and source.get(raw_key) is not None:
            try:
                values[field] = max(0, int(source.get(raw_key)))
            except (TypeError, ValueError):
                raise ApiError(f"授权配额必须是非负整数: {raw_key}", 400, code="VALIDATION")
    if not values:
        return
    from open_api.entitlements import update_entitlement

    update_entitlement(client_id, values)


class OpenClientView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not (
            has_permission(request.auth_ctx, "open:manage")
            or has_permission(request.auth_ctx, "system:write")
        ):
            raise ApiError("权限不足", 403)
        # 客户账号禁止看全站凭证
        assert_platform(request)
        items = IntegrationClient.objects.all().order_by("-created_at")
        payload = []
        for c in items:
            row = _serialize_client(c)
            row["usage"] = usage_payload(c)
            payload.append(row)
        return Response({"items": payload, "total": items.count()})

    def post(self, request):
        if not (
            has_permission(request.auth_ctx, "open:manage")
            or has_permission(request.auth_ctx, "system:write")
        ):
            raise ApiError("权限不足", 403)
        assert_platform(request)
        name = (request.data.get("name") or "").strip()
        code = (request.data.get("code") or "").strip()
        if not name or not code:
            raise ApiError("请填写名称和编码", 400)
        if IntegrationClient.objects.filter(code=code).exists():
            raise ApiError("编码已存在", 400)
        raw = generate_api_key()
        scopes = request.data.get("scopes") or DEFAULT_SCOPES
        client = IntegrationClient(
            name=name,
            code=code,
            description=request.data.get("description") or "",
            key_prefix=raw[:10],
            key_hash=hash_api_key(raw),
            scopes=scopes,
            status=request.data.get("status") or "active",
            callback_url=request.data.get("callbackUrl") or request.data.get("callback_url") or "",
            created_by=_actor_id(request),
        )
        _apply_client_fields(client, request.data)
        client.save()
        _apply_entitlements(client.id, request.data)
        ensure_default_workspace(client)
        audit_from_request(
            request, action="CREATE", resource_type="SYSTEM",
            resource_id=client.id, resource_name=client.name,
            detail={"kind": "integrationClient"},
        )
        return Response(_serialize_client(client, api_key=raw))

    def put(self, request):
        if not _can_manage_open(request):
            raise ApiError("权限不足", 403)
        assert_platform(request)
        client_id = q(request, "id") or request.data.get("id")
        client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("凭证不存在", 404)
        _apply_client_fields(client, request.data)
        client.save()
        _apply_entitlements(client.id, request.data)
        return Response(_serialize_client(client))

    def delete(self, request):
        if not (
            has_permission(request.auth_ctx, "open:manage")
            or has_permission(request.auth_ctx, "system:write")
        ):
            raise ApiError("权限不足", 403)
        assert_platform(request)
        client_id = q(request, "id") or request.data.get("id")
        client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("凭证不存在", 404)
        client.delete()
        return Response({"success": True})


def _can_manage_open(request) -> bool:
    return has_permission(request.auth_ctx, "open:manage") or has_permission(request.auth_ctx, "system:write")


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    return [x.strip() for x in str(value).replace(",", "\n").splitlines() if x.strip()]


def _apply_client_fields(client: IntegrationClient, data: dict) -> None:
    if "name" in data and data.get("name"):
        client.name = str(data.get("name")).strip()
    if "description" in data:
        client.description = data.get("description") or ""
    if "status" in data and data.get("status"):
        client.status = data.get("status")
    if "callbackUrl" in data or "callback_url" in data:
        client.callback_url = data.get("callbackUrl") or data.get("callback_url") or ""
    if "ipWhitelist" in data or "ip_whitelist" in data:
        client.ip_whitelist = _as_list(data.get("ipWhitelist") if "ipWhitelist" in data else data.get("ip_whitelist"))
    if "rateLimitPerMinute" in data or "rate_limit_per_minute" in data:
        try:
            client.rate_limit_per_minute = int(data.get("rateLimitPerMinute") or data.get("rate_limit_per_minute") or 60)
        except (TypeError, ValueError):
            client.rate_limit_per_minute = 60
    if "alertEmail" in data or "alert_email" in data:
        client.alert_email = data.get("alertEmail") or data.get("alert_email") or ""
    if "alertWebhookUrl" in data or "alert_webhook_url" in data:
        client.alert_webhook_url = data.get("alertWebhookUrl") or data.get("alert_webhook_url") or ""
    if "sandbox" in data:
        client.sandbox = bool(data.get("sandbox"))
    if "monthlyCallQuota" in data or "monthly_call_quota" in data:
        try:
            client.monthly_call_quota = int(data.get("monthlyCallQuota") or data.get("monthly_call_quota") or 0)
        except (TypeError, ValueError):
            client.monthly_call_quota = 0
    if "monthlyRowQuota" in data or "monthly_row_quota" in data:
        try:
            client.monthly_row_quota = int(data.get("monthlyRowQuota") or data.get("monthly_row_quota") or 0)
        except (TypeError, ValueError):
            client.monthly_row_quota = 0
    if "scopes" in data and isinstance(data.get("scopes"), list):
        client.scopes = data.get("scopes")


class OpenClientRotateView(APIView):
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        client = getattr(getattr(request, "auth_ctx", None), "client", None)
        if client is None:
            if not _can_manage_open(request):
                raise ApiError("权限不足", 403)
            assert_platform(request)
            client_id = request.data.get("id") or q(request, "id")
            client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("凭证不存在", 404)
        raw = generate_api_key()
        client.key_prefix = raw[:10]
        client.key_hash = hash_api_key(raw)
        client.save(update_fields=["key_prefix", "key_hash", "updated_at"])
        audit_from_request(
            request, action="UPDATE", resource_type="SYSTEM",
            resource_id=client.id, resource_name=client.name,
            detail={"kind": "rotateApiKey"},
        )
        return Response(_serialize_client(client, api_key=raw))


class OpenMeView(OpenAuthMixin, APIView):
    def get(self, request):
        client = getattr(getattr(request, "auth_ctx", None), "client", None)
        if client is None:
            raise ApiError("请使用 API Key 调用", 401, code="UNAUTHORIZED")
        data = _serialize_client(client)
        data["usage"] = usage_payload(client)
        data["workspace"] = serialize_workspace(ensure_default_workspace(client))
        return Response(data)


class OpenUsageView(OpenAuthMixin, APIView):
    def get(self, request):
        client = getattr(getattr(request, "auth_ctx", None), "client", None)
        if client is None:
            if not _can_manage_open(request):
                raise ApiError("权限不足", 403)
            assert_platform(request)
            client_id = q(request, "clientId", "id") or request.GET.get("clientId")
            client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("凭证不存在", 404, code="NOT_FOUND")
        return Response(usage_payload(client))


class OpenWorkspaceView(OpenAuthMixin, APIView):
    def get(self, request):
        client = getattr(getattr(request, "auth_ctx", None), "client", None)
        if client is None:
            if not _can_manage_open(request):
                raise ApiError("权限不足", 403)
            assert_platform(request)
            ensure_platform_workspace()
            client_id = q(request, "clientId")
            qs = PartnerWorkspace.objects.all().order_by("-created_at")
            if client_id:
                qs = qs.filter(client_id=client_id)
        else:
            qs = PartnerWorkspace.objects.filter(client_id=client.id).order_by("-created_at")
            if not qs.exists():
                ensure_default_workspace(client)
                qs = PartnerWorkspace.objects.filter(client_id=client.id)
        items = [serialize_workspace(w) for w in qs]
        return Response({"items": items, "total": len(items)})

    def post(self, request):
        client = getattr(getattr(request, "auth_ctx", None), "client", None)
        client_id = ""
        if client is None:
            if not _can_manage_open(request):
                raise ApiError("权限不足", 403)
            assert_platform(request)
            raw_client = (request.data.get("clientId") or request.data.get("client_id") or "").strip()
            if raw_client:
                row = IntegrationClient.objects.filter(id=raw_client).first()
                if not row:
                    raise ApiError("凭证不存在", 404, code="NOT_FOUND")
                client_id = row.id
        else:
            require_scope(request, "job:write", "datasource:write", "app:write")
            client_id = client.id
        ws = create_workspace(
            name=request.data.get("name") or "",
            code=request.data.get("code") or "",
            client_id=client_id,
            environment=request.data.get("environment") or "",
            status=request.data.get("status") or "active",
        )
        return Response(serialize_workspace(ws))


class OpenDatasourceInspectView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "datasource:read")
        ds_id = request.data.get("id") or request.data.get("datasourceId")
        if not ds_id:
            raise ApiError("缺少 datasourceId", 400, code="VALIDATION")
        ds = Datasource.objects.filter(id=ds_id).first()
        if not ds:
            raise ApiError("数据源不存在", 404, code="NOT_FOUND")
        assert_object_owned(ds, request, not_found="数据源不存在")
        table = request.data.get("table") or request.data.get("path") or ""
        return Response(inspect_datasource(ds, table=str(table or "")))


class OpenJobPreviewView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "job:read", "datasource:read")
        ds_id = request.data.get("datasourceId") or request.data.get("sourceDatasourceId")
        if not ds_id:
            raise ApiError("缺少 datasourceId", 400, code="VALIDATION")
        ds = Datasource.objects.filter(id=ds_id).first()
        if not ds:
            raise ApiError("数据源不存在", 404, code="NOT_FOUND")
        assert_object_owned(ds, request, not_found="数据源不存在")
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


class OpenJobPromoteView(OpenAuthMixin, APIView):
    def post(self, request):
        require_scope(request, "job:write")
        ref = request.data.get("jobId") or request.data.get("job_id") or request.data.get("code")
        if not ref:
            raise ApiError("缺少 jobId", 400, code="VALIDATION")
        job = _load_job(str(ref))
        assert_object_owned(job, request, not_found="任务不存在")
        target = request.data.get("targetEnvironment") or request.data.get("environment") or "prod"
        promoted = promote_job(job, target_env=str(target), created_by=_actor_id(request))
        return Response(JobSerializer(promoted).data)


class OpenStatusView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from django.conf import settings

        from datasources.connectors.runtime import SUPPORTED_EXTRACT, SUPPORTED_LOAD

        return Response({
            "status": "ok",
            "environment": getattr(settings, "ENVIRONMENT", "dev"),
            "queueBackend": getattr(settings, "QUEUE_BACKEND", None) or "memory",
            "runtime": {
                "extract": sorted(SUPPORTED_EXTRACT),
                "load": sorted(SUPPORTED_LOAD),
            },
        })


class OpenErrorCatalogView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"items": ERROR_CATALOG, "total": len(ERROR_CATALOG)})


class OpenChangelogView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"items": CHANGELOG, "total": len(CHANGELOG)})


class OpenRegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        from django.conf import settings

        from core.throttling import check_register_rate_limit
        from open_api.auth import request_ip

        if not getattr(settings, "OPEN_REGISTER_ENABLED", True):
            raise ApiError("自助开户未开放，请联系中台管理员发放密钥", 403)
        invite = str(getattr(settings, "OPEN_REGISTER_INVITE", "") or "")
        if invite:
            given = str(request.data.get("inviteCode") or request.data.get("invite") or "").strip()
            if given != invite:
                raise ApiError("邀请码无效", 403, code="UNAUTHORIZED")
        ip = request_ip(request)
        allowed, _ = check_register_rate_limit(ip)
        if not allowed:
            raise ApiError("开户过于频繁，请稍后再试", 429, code="RATE_LIMITED")
        name = (request.data.get("name") or "").strip()
        code = (request.data.get("code") or "").strip().lower()
        if not name or not code:
            raise ApiError("请填写名称和编码", 400, code="VALIDATION")
        import re

        if not re.match(r"^[a-z][a-z0-9_-]{1,62}$", code):
            raise ApiError("编码需小写字母开头，仅含字母、数字、下划线和短横线", 400, code="VALIDATION")
        if IntegrationClient.objects.filter(code=code).exists():
            raise ApiError("编码已存在", 400, code="VALIDATION")
        raw = generate_api_key()
        client = IntegrationClient(
            name=name,
            code=code,
            description=request.data.get("description") or "自助沙箱开户",
            key_prefix=raw[:10],
            key_hash=hash_api_key(raw),
            scopes=list(DEFAULT_SCOPES),
            status="active",
            sandbox=True,
            rate_limit_per_minute=30,
            monthly_call_quota=int(getattr(settings, "OPEN_SANDBOX_CALL_QUOTA", 10000) or 10000),
            monthly_row_quota=int(getattr(settings, "OPEN_SANDBOX_ROW_QUOTA", 100000) or 100000),
        )
        client.save()
        # 沙箱授权：仅限制月调用 / 月行数，任务席位连接器 0=不限
        from open_api.entitlements import ensure_entitlement

        ensure_entitlement(
            client.id,
            max_api_calls_monthly=int(getattr(settings, "OPEN_SANDBOX_CALL_QUOTA", 10000) or 10000),
            max_rows_monthly=int(getattr(settings, "OPEN_SANDBOX_ROW_QUOTA", 100000) or 100000),
        )
        ensure_default_workspace(client)
        data = _serialize_client(client, api_key=raw)
        data["usage"] = usage_payload(client)
        data["docs"] = "/api/open/docs"
        data["sdk"] = "/api/open/sdk"
        return Response(data)


class OpenSdkView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from django.conf import settings

        base = (getattr(settings, "PUBLIC_BASE_URL", "http://127.0.0.1:8000") or "").rstrip("/") + "/api"
        return Response({
            "openapi": "/api/open/openapi.json",
            "python": {
                "install": "pip install -e sdk/python",
                "path": "sdk/python",
                "snippet": (
                    "from integration_hub import IntegrationHub\n"
                    f"hub = IntegrationHub(api_key='ipk_...', base_url='{base}')\n"
                    "print(hub.catalog())\n"
                    "hub.trigger_job('job_xxx')"
                ),
            },
            "typescript": {
                "install": "cd sdk/typescript && npm install",
                "path": "sdk/typescript",
                "snippet": (
                    "import { IntegrationHub } from './src/index.ts'\n"
                    f"const hub = new IntegrationHub({{ apiKey: 'ipk_...', baseUrl: '{base}' }})\n"
                    "await hub.catalog()"
                ),
            },
            "generator": "npx @openapitools/openapi-generator-cli generate -i /api/open/openapi.json -g python -o ./generated",
        })
