"""开放集成服务：目录、凭证、应用 / 数据源 / 任务门面。"""
from __future__ import annotations

import logging
import time as _time

from django.utils import timezone

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

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


def _verify_hook_signature(request, secret: str) -> bool:
    """HMAC-SHA256 签名模式：X-Hub-Timestamp + X-Hub-Signature-256（sha256=hex）。
    签名内容 = f"{timestamp}.{raw_body}"，时间窗 ±300 秒防重放。密钥不出现在传输中。"""
    import hashlib
    import hmac as _hmac
    import secrets as _secrets
    import time

    ts = (request.META.get("HTTP_X_HUB_TIMESTAMP") or "").strip()
    sig = (request.META.get("HTTP_X_HUB_SIGNATURE_256") or "").strip()
    if not ts or not sig:
        return False
    try:
        ts_int = int(ts)
    except (TypeError, ValueError):
        return False
    if abs(time.time() - ts_int) > 300:
        logger.warning("Webhook 签名时间戳超出时间窗: ts=%s", ts)
        return False
    raw = request.body or b""
    expect = "sha256=" + _hmac.new(secret.encode(), ts.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return _secrets.compare_digest(expect, sig)


def _authorize_hook(request, job: IntegrationJob) -> str:
    import secrets as _secrets

    expected = (job.webhook_secret or "").strip()
    schedule_type = (getattr(job, "schedule_type", "") or "manual").lower()
    if expected:
        # 配置了 webhook_secret：强制签名校验，防重放 + 防试探
        if _verify_hook_signature(request, expected):
            return "webhook"
        header = (request.META.get("HTTP_X_WEBHOOK_SECRET") or "").strip()
        if header and _secrets.compare_digest(header, expected):
            return "webhook"
        # 带了 Secret/签名头但校验失败：直接 401，不再降级到 API Key（防止试探）
        if header or request.META.get("HTTP_X_HUB_SIGNATURE_256"):
            raise ApiError("Webhook 签名校验失败", 401, code="BAD_WEBHOOK_SIGNATURE")
    # 未配置 webhook_secret 时：
    # - schedule_type="webhook" 触发正常 ETL：允许匿名（但安全警告）
    # - 否则（传统 push records 模式）：要求 API Key 或 webhook_secret
    if schedule_type == "webhook" and expected == "":
        logger.warning(
            "Webhook 任务 %s 未配置 webhook_secret，当前允许匿名触发——生产务必补配置", job.code,
        )
        return "anonymous"
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
        # schedule_type=webhook 匿名触发正常 ETL 管道，不强制 accepts_push
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

    # 白标品牌字段（两种命名都兼容：DRF parser 会转成 snake_case）
    branding_fields = (
        "branding_logo_url",
        "branding_logo_dark_url",
        "branding_primary_color",
        "branding_secondary_color",
        "branding_company_name",
        "branding_product_name",
    )
    for field in branding_fields:
        camel = "".join(p.capitalize() if i else p for i, p in enumerate(field.split("_")))
        if field in data or camel in data:
            setattr(client, field, data.get(field) if field in data else data.get(camel))
    if "embed_allowed_origins" in data or "embedAllowedOrigins" in data:
        origins = data.get("embed_allowed_origins") if "embed_allowed_origins" in data else data.get("embedAllowedOrigins")
        client.embed_allowed_origins = _as_list(origins)


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

        from core.public_urls import api_base_url, api_prefix, canonical_issuer, public_origin
        from datasources.connectors.runtime import SUPPORTED_EXTRACT, SUPPORTED_LOAD

        meta = request.META
        return Response({
            "status": "ok",
            "environment": getattr(settings, "ENVIRONMENT", "dev"),
            "queueBackend": getattr(settings, "QUEUE_BACKEND", None) or "memory",
            "urls": {
                # 静态对外口径：discovery / SDK baseUrl / 回调地址全部以此为准
                "origin": public_origin(),
                "apiPrefix": api_prefix(),
                "apiBaseUrl": api_base_url(),
                "issuer": canonical_issuer(),
            },
            "request": {
                # 本次请求 Django 实际看到的信息；反代后若与 urls 不一致，
                # 说明 Nginx 未透传 X-Forwarded-* 或未开 TRUST_PROXY_HEADERS
                "host": request.get_host(),
                "scheme": request.scheme,
                "forwardedHost": meta.get("HTTP_X_FORWARDED_HOST", ""),
                "forwardedProto": meta.get("HTTP_X_FORWARDED_PROTO", ""),
                "forwardedFor": (meta.get("HTTP_X_FORWARDED_FOR", "") or "").split(",")[0].strip(),
            },
            "trustedProxyHeaders": bool(getattr(settings, "TRUST_PROXY_HEADERS", False)),
            "runtime": {
                "extract": sorted(SUPPORTED_EXTRACT),
                "load": sorted(SUPPORTED_LOAD),
            },
        })


class OpenHealthView(APIView):
    """公开健康检查：DB / Redis / 队列 / 版本。"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from django.db import connection
        from django.conf import settings

        checks = {"db": True, "redis": None, "queue": "memory", "version": settings.PLATFORM_VERSION}
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT 1")
        except Exception as exc:
            checks["db"] = False
            checks["db_error"] = str(exc)
        redis_url = getattr(settings, "REDIS_URL", "") or ""
        if redis_url:
            try:
                import redis as _r
                client = _r.Redis.from_url(redis_url, socket_timeout=1)
                client.ping()
                checks["redis"] = True
            except Exception as exc:
                checks["redis"] = False
                checks["redis_error"] = str(exc)
            if getattr(settings, "QUEUE_BACKEND", "") == "celery":
                checks["queue"] = "celery"
            else:
                checks["queue"] = "memory"
        status = 200 if checks["db"] is True else 503
        return Response(checks, status=status)


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
        # 沙箱授权：3 个集成任务 / 月度行数 10 万 / 月度调用 1 万；席位与连接器 0=不限
        from open_api.entitlements import ensure_entitlement

        ensure_entitlement(
            client.id,
            plan="trial",
            expires_at=(
                __import__("django.utils.timezone", fromlist=["timezone"]).timezone.now()
                + __import__("datetime", fromlist=["timedelta"]).timedelta(days=30)
            ),
            max_jobs=int(getattr(settings, "OPEN_SANDBOX_JOB_QUOTA", 3) or 3),
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
        from core.public_urls import api_base_url, api_url

        base = api_base_url()
        return Response({
            "openapi": api_url("/open/openapi.json"),
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
            "generator": f"npx @openapitools/openapi-generator-cli generate -i {api_url('/open/openapi.json')} -g python -o ./generated",
            "builds": _list_sdk_builds(),
            "latest": _latest_sdk_build(),
        })


def _sdk_dist_dir() -> str:
    import os
    from django.conf import settings
    # 项目根目录下的 sdk/python/dist
    root = getattr(settings, "BASE_DIR", None)
    if root is None:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # BASE_DIR 在本项目中通常指向 backend/，sdk 在上一级
    return os.path.join(os.path.dirname(str(root)), "sdk", "python", "dist")


def _list_sdk_builds() -> list[dict]:
    """扫描 sdk/python/dist 目录，返回最近 10 次构建（按 mtime 倒序）。"""
    import os
    dist = _sdk_dist_dir()
    if not os.path.isdir(dist):
        return []
    items = []
    for name in os.listdir(dist):
        full = os.path.join(dist, name)
        if not os.path.isfile(full):
            continue
        if not (name.endswith(".whl") or name.endswith(".tar.gz")):
            continue
        stat = os.stat(full)
        # 解析版本号：integration_hub-1.5.0-py3-none-any.whl → 1.5.0
        # sdist: integration_hub-1.5.0.tar.gz → 1.5.0
        stem = name
        for suffix in (".whl", ".tar.gz"):
            if stem.endswith(suffix):
                stem = stem[: -len(suffix)]
                break
        parts = stem.split("-")
        version = parts[1] if len(parts) >= 2 else ""
        items.append({
            "filename": name,
            "version": version,
            "size": stat.st_size,
            "sizeText": _human_size(stat.st_size),
            "mtime": int(stat.st_mtime),
            "kind": "wheel" if name.endswith(".whl") else "sdist",
            "downloadUrl": f"/api/open/sdk/download?file={name}",
        })
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return items[:10]


def _latest_sdk_build() -> dict | None:
    items = _list_sdk_builds()
    wheels = [x for x in items if x["kind"] == "wheel"]
    return wheels[0] if wheels else (items[0] if items else None)


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


class OpenSdkBuildView(APIView):
    """触发构建 Python SDK wheel，返回新构建产物。仅平台账号可调用。"""
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from audit.services import audit_from_request
        assert_platform(request, "仅平台账号可构建 SDK")

        import os
        import subprocess
        from django.conf import settings

        dist = _sdk_dist_dir()
        root = getattr(settings, "BASE_DIR", None)
        if root is None:
            root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sdk_dir = os.path.join(os.path.dirname(str(root)), "sdk", "python")
        if not os.path.isdir(sdk_dir):
            raise ApiError("SDK 源码目录不存在", 404)

        # 选一个装了 build 模块的 python：venv → 当前进程 → PATH
        import sys
        candidates = [
            os.path.join(str(root), ".venv", "Scripts", "python.exe"),
            sys.executable,
            "python",
        ]

        def _has_build(py: str) -> bool:
            try:
                r = subprocess.run(
                    [py, "-m", "build", "--version"],
                    capture_output=True, text=True, timeout=20,
                )
                return r.returncode == 0
            except Exception:
                # python 不可执行 / build 未装 / subprocess 超时，都让下一个候选接手
                return False

        venv_python = next((p for p in candidates if _has_build(p)), "")
        if not venv_python:
            # 兜底：给 venv 装 build
            venv_py = candidates[0]
            try:
                subprocess.run(
                    [venv_py, "-m", "pip", "install", "--quiet", "build>=1.2"],
                    capture_output=True, text=True, timeout=180,
                )
                venv_python = venv_py
            except Exception:
                raise ApiError("未找到可用的 python-build，请先 pip install build", 500)

        # 自动写 local version 后缀（1.5.0+YYYYMMDD.HHMMSS），让每次构建产物
        # 文件名不同、"最近 10 次构建"真实可累积；构建后无论成败恢复 pyproject
        import re
        from datetime import datetime
        pyproject_path = os.path.join(sdk_dir, "pyproject.toml")
        original_pyproject = ""
        build_version = ""
        if os.path.isfile(pyproject_path):
            original_pyproject = open(pyproject_path, "r", encoding="utf-8").read()
            m = re.search(r'^version\s*=\s*"([^"]+)"', original_pyproject, re.M)
            base_version = m.group(1) if m else "0.0.0"
            # 去掉已有 local 后缀
            base_version = base_version.split("+")[0]
            stamp = datetime.now().strftime("%Y%m%d.%H%M%S")
            build_version = f"{base_version}+{stamp}"
            updated = re.sub(
                r'^(version\s*=\s*")[^"]+(")',
                lambda mm: f"{mm.group(1)}{build_version}{mm.group(2)}",
                original_pyproject, count=1, flags=re.M,
            )
            open(pyproject_path, "w", encoding="utf-8").write(updated)

        try:
            result = subprocess.run(
                [venv_python, "-m", "build"],
                cwd=sdk_dir,
                capture_output=True,
                text=True,
                timeout=180,
            )
        except subprocess.TimeoutExpired:
            raise ApiError("构建超时（>180s）", 504)
        finally:
            if original_pyproject:
                open(pyproject_path, "w", encoding="utf-8").write(original_pyproject)
        if result.returncode != 0:
            raise ApiError(f"构建失败: {result.stderr[-500:]}", 500)

        builds = _list_sdk_builds()
        latest = _latest_sdk_build()
        audit_from_request(
            request, action="BUILD_SDK", resource_type="SDK",
            resource_name="integration_hub",
            detail={"version": latest.get("version") if latest else None,
                    "filename": latest.get("filename") if latest else None},
        )
        return Response({
            "ok": True,
            "latest": latest,
            "builds": builds,
            "stdoutTail": result.stdout[-500:] if result.stdout else "",
        })


class OpenSdkDownloadView(APIView):
    """下载指定 SDK wheel/sdist 文件。"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        import os
        from django.http import FileResponse, Http404

        filename = q(request, "file")
        if not filename or "/" in filename or "\\" in filename or ".." in filename:
            raise ApiError("非法文件名", 400)
        if not (filename.endswith(".whl") or filename.endswith(".tar.gz")):
            raise ApiError("仅支持 wheel / sdist 文件", 400)

        full = os.path.join(_sdk_dist_dir(), filename)
        if not os.path.isfile(full):
            raise Http404("文件不存在")
        ctype = "application/octet-stream"
        if filename.endswith(".whl"):
            ctype = "application/octet-stream"
        resp = FileResponse(open(full, "rb"), content_type=ctype)
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp


# ======================== 按行计费 / 账单 ========================

class BillingPlanView(APIView):
    """计费套餐 CRUD：`GET /api/billing/plans` 列表、`POST /api/billing/plans` 创建、`PUT /api/billing/plans/{id}` 更新、`DELETE` 归档。"""

    # 集成商用 API Key 自助管理自己的套餐，控制台用 JWT
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]

    def get(self, request):
        from open_api.models import BillingPlan
        from core.tenancy import is_platform

        auth = getattr(request, "auth_ctx", None)
        cid = principal_client_id(request)
        is_plat = is_platform(request)
        qs = BillingPlan.objects.all()
        if not is_plat:
            qs = qs.filter(client_id=cid)
        return Response([
            {
                "id": bp.id, "clientId": bp.client_id,
                "pricePerRow": float(bp.price_per_row),
                "pricePerApiCall": float(bp.price_per_api_call),
                "monthlyBaseFee": float(bp.monthly_base_fee),
                "freeRowsPerMonth": bp.free_rows_per_month,
                "freeApiCallsPerMonth": bp.free_api_calls_per_month,
                "currency": bp.currency, "taxRate": float(bp.tax_rate),
                "effectiveFrom": bp.effective_from.isoformat(),
                "effectiveTo": bp.effective_to.isoformat() if bp.effective_to else None,
                "status": bp.status, "note": bp.note,
            }
            for bp in qs.order_by("-updated_at")
        ])

    def post(self, request):
        from open_api.models import BillingPlan
        from core.tenancy import is_platform

        data = _body(request)
        # tenant 隔离：非平台账号强制写自己的 client_id
        client_id = principal_client_id(request) if not is_platform(request) else (
            data.get("client_id") or principal_client_id(request)
        )
        if not client_id:
            raise ApiError("需要 clientId", 400)
        # 归档套餐不算"已有"——归档后允许新建
        if BillingPlan.objects.filter(client_id=client_id, status="active").exists():
            raise ApiError("该 client 已有有效计费套餐，请使用 PUT 更新或 DELETE 归档后新建", 409)
        plan = BillingPlan.objects.create(
            client_id=client_id,
            price_per_row=float(data.get("price_per_row", 0)),
            price_per_api_call=float(data.get("price_per_api_call", 0)),
            monthly_base_fee=float(data.get("monthly_base_fee", 0)),
            free_rows_per_month=int(data.get("free_rows_per_month", 0)),
            free_api_calls_per_month=int(data.get("free_api_calls_per_month", 0)),
            currency=data.get("currency", "CNY"),
            tax_rate=float(data.get("tax_rate", 0.06)),
            effective_from=data.get("effective_from") or timezone.localdate(),
            effective_to=data.get("effective_to") or None,
            status=data.get("status", "active"),
            note=data.get("note", ""),
        )
        return Response({"id": plan.id, "message": "计费套餐已保存"})

    def put(self, request, plan_id: str):
        from open_api.models import BillingPlan
        from core.tenancy import is_platform

        plan = BillingPlan.objects.filter(id=plan_id).first()
        if not plan:
            raise ApiError("计费套餐不存在", 404)
        if not is_platform(request) and plan.client_id != principal_client_id(request):
            raise ApiError("无权修改其他客户的计费套餐", 403)

        data = _body(request)
        float_fields = [
            "price_per_row", "price_per_api_call", "monthly_base_fee", "tax_rate",
        ]
        int_fields = ["free_rows_per_month", "free_api_calls_per_month"]
        for name in float_fields:
            if name in data:
                setattr(plan, name, float(data[name]))
        for name in int_fields:
            if name in data:
                setattr(plan, name, int(data[name]))
        if "currency" in data:
            plan.currency = data["currency"]
        if data.get("effective_from"):
            plan.effective_from = data["effective_from"]
        if "effective_to" in data:
            plan.effective_to = data["effective_to"] or None
        if "status" in data:
            plan.status = data["status"]
        if "note" in data:
            plan.note = data["note"]
        plan.save()
        return Response({"id": plan.id, "message": "计费套餐已更新"})

    def delete(self, request, plan_id: str):
        from open_api.models import BillingPlan
        from core.tenancy import is_platform

        plan = BillingPlan.objects.filter(id=plan_id).first()
        if not plan:
            raise ApiError("计费套餐不存在", 404)
        if not is_platform(request) and plan.client_id != principal_client_id(request):
            raise ApiError("无权归档其他客户的计费套餐", 403)
        if plan.status != "active":
            raise ApiError("只有 active 的套餐才能归档", 400)
        # 归档用 dated 后缀，避免 unique_together(client_id, status) 冲突
        # （同一 client 一天归档多次也会撞，用时间戳更稳）
        plan.status = f"archived_{timezone.now().strftime('%Y%m%d%H%M%S')}"
        plan.save(update_fields=["status", "updated_at"])
        return Response({"id": plan.id, "status": plan.status, "message": "计费套餐已归档"})


class InvoiceView(APIView):
    """月度账单：`GET /api/invoices?month=2026-09` 列表、`POST /api/invoices/generate` 触发生成、`GET /api/invoices/{id}/preview` 预览某 client 某月。"""

    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]

    def get(self, request):
        from open_api.billing import invoice_pdf_url
        from open_api.models import Invoice
        from core.tenancy import is_platform

        auth = getattr(request, "auth_ctx", None)
        cid = principal_client_id(request)
        is_plat = is_platform(request)
        month = q(request, "month")  # '2026-09'

        qs = Invoice.objects.all()
        if not is_plat:
            qs = qs.filter(client_id=cid)
        if month:
            start = f"{month}-01"
            qs = qs.filter(period_start=start)

        return Response([
            {
                "id": inv.id, "invoiceNumber": inv.invoice_number,
                "clientId": inv.client_id,
                "periodStart": inv.period_start.isoformat(),
                "periodEnd": inv.period_end.isoformat(),
                "rowsWritten": inv.rows_written,
                "rowsInvoiced": inv.rows_invoiced,
                "apiCalls": inv.api_calls,
                "apiCallsInvoiced": inv.api_calls_invoiced,
                "baseFee": float(inv.base_fee),
                "rowsAmount": float(inv.rows_amount),
                "apiAmount": float(inv.api_amount),
                # 未税小计 = 基费 + 行费用 + 调用费用（税额另计）
                "subtotal": float(inv.base_fee) + float(inv.rows_amount) + float(inv.api_amount),
                "taxAmount": float(inv.tax_amount),
                "totalAmount": float(inv.total_amount),
                "currency": inv.currency,
                "status": inv.status,
                "issuedAt": inv.issued_at.isoformat() if inv.issued_at else None,
                "paidAt": inv.paid_at.isoformat() if inv.paid_at else None,
                "voidedAt": inv.voided_at.isoformat() if inv.voided_at else None,
                "voidReason": inv.void_reason,
                "pdfUrl": invoice_pdf_url(inv),
            }
            for inv in qs.order_by("-period_start", "-created_at")
        ])

    def post(self, request):
        from open_api.billing import generate_monthly_invoices, compute_bill
        from open_api.models import BillingPlan
        from core.tenancy import is_platform

        data = _body(request)
        action = data.get("action") or "generate"
        month = data.get("month")
        client_id = data.get("client_id")
        is_plat = is_platform(request)

        if month:
            import re

            if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", str(month)):
                raise ApiError("month 格式应为 YYYY-MM", 400)

        # 非平台账号：强制忽略前端传的 clientId，只能操作自己的
        if not is_plat:
            client_id = principal_client_id(request)

        if action == "generate":
            invoices = generate_monthly_invoices(month=month, client_id=client_id)
            return Response({
                "generated": len(invoices),
                "invoices": [{"id": inv.id, "number": inv.invoice_number, "total": float(inv.total_amount)} for inv in invoices],
            })
        if action == "preview":
            if not client_id:
                raise ApiError("preview 需要 clientId（平台账号需显式传；集成商自动识别）", 400)
            plan = BillingPlan.objects.filter(client_id=client_id, status="active").first()
            if not plan:
                raise ApiError("当前 client 无有效计费套餐，无法预览账单", 404)
            bill = compute_bill(plan, month)
            return Response(bill)
        if action in ("void", "pay"):
            from open_api.billing import pay_invoice, void_invoice
            from open_api.models import Invoice

            invoice_id = data.get("invoice_id") or data.get("id")
            if not invoice_id:
                raise ApiError(f"{action} 需要 invoiceId", 400)
            inv = Invoice.objects.filter(id=invoice_id).first()
            if not inv:
                raise ApiError("账单不存在", 404)
            # tenant 隔离：集成商只能操作自己的账单
            if not is_plat and inv.client_id != client_id:
                raise ApiError("无权操作其他客户的账单", 403)
            try:
                if action == "void":
                    void_invoice(inv, data.get("void_reason") or data.get("reason") or "")
                else:
                    pay_invoice(inv)
            except ValueError as exc:
                raise ApiError(str(exc), 400)
            inv.refresh_from_db()
            return Response({
                "id": inv.id,
                "status": inv.status,
                "paidAt": inv.paid_at.isoformat() if inv.paid_at else None,
                "voidedAt": inv.voided_at.isoformat() if inv.voided_at else None,
                "voidReason": inv.void_reason,
            })
        raise ApiError(f"未知 action: {action}", 400)


class InvoicePdfView(APIView):
    """GET /api/invoices/{id}/pdf —— 账单 PDF 下载（tenant 隔离）。"""

    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]

    def get(self, request, invoice_id: str):
        from django.http import HttpResponse

        from open_api.billing import generate_invoice_pdf
        from open_api.models import Invoice
        from core.tenancy import is_platform

        inv = Invoice.objects.filter(id=invoice_id).first()
        if not inv:
            raise ApiError("账单不存在", 404)
        if not is_platform(request) and inv.client_id != principal_client_id(request):
            raise ApiError("无权访问其他客户的账单", 403)

        try:
            pdf_bytes = generate_invoice_pdf(inv)
        except ImportError:
            raise ApiError("服务端未安装 reportlab，无法导出 PDF", 500)

        filename = f"{inv.invoice_number or inv.id}.pdf"
        resp = HttpResponse(pdf_bytes, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp


# ======================== SLA 状态页 ========================

# 公开状态页 60 秒缓存：避免匿名请求反复全表扫执行记录
_STATUS_CACHE: dict[tuple, tuple[float, dict]] = {}
_STATUS_CACHE_TTL = 60
_STATUS_RATE_LIMIT = 120  # 每 IP 每分钟


def _status_cache_get(key: tuple) -> dict | None:
    item = _STATUS_CACHE.get(key)
    if item and _time.time() - item[0] < _STATUS_CACHE_TTL:
        return item[1]
    return None


def _status_cache_set(key: tuple, value: dict) -> None:
    if len(_STATUS_CACHE) > 256:
        _STATUS_CACHE.clear()
    _STATUS_CACHE[key] = (_time.time(), value)


def _public_client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or ""


class PublicStatusView(APIView):
    """对外公开的平台 SLA 状态。

    平台级（不传 clientId）匿名可读；client 级必须携带该租户的 embed token 或已登录。
    """
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]
    permission_classes = [AllowAny]

    def get(self, request):
        from core.throttling import check_public_rate_limit
        from monitor.sla import compute_sla

        allowed, wait_ms = check_public_rate_limit(
            _public_client_ip(request), "status", limit=_STATUS_RATE_LIMIT
        )
        if not allowed:
            resp = Response({"error": "请求过于频繁，请稍后再试"}, status=429)
            resp["Retry-After"] = str(max(wait_ms // 1000, 1))
            return resp

        try:
            days = int(q(request, "days") or 30)
        except ValueError:
            days = 30
        days = max(1, min(days, 90))  # 防止超大窗口拖垮数据库
        client_id = q(request, "clientId") or ""
        is_client_scope = bool(client_id)

        # client 级数据属于特定租户：匿名必须持有嵌入签名 token
        if is_client_scope:
            authed = getattr(getattr(request, "user", None), "is_authenticated", False)
            token = q(request, "token")
            if not authed and not _verify_embed_token(client_id, token, request):
                return Response({"error": "无权查看该租户的 SLA 状态"}, status=403)

        cache_key = (client_id, days)
        payload = _status_cache_get(cache_key)
        if payload is None:
            sla = compute_sla(days=days, client_id=client_id or None)

            def _friend(outage: dict) -> dict:
                """对外只暴露客户友好聚合指标，剥离 sample_error 等内部细节。"""
                return {
                    "start": outage.get("start"),
                    "end": outage.get("end"),
                    "durationSeconds": outage.get("duration_seconds"),
                    "impactedJobs": outage.get("impacted_jobs"),
                    "kind": outage.get("kind", "execution"),
                }

            payload = {
                "status": sla["sla"]["status"],
                "uptime30d": sla["uptime30d"],
                "successRate": sla["executions"]["successRate"],
                "totalExecutions": sla["executions"]["total"],
                "failures": sla["executions"]["failed"],
                "sla": sla["sla"],
                "infrastructure": {
                    "heartbeatGaps": sla["infrastructure"]["heartbeatGaps"],
                    "heartbeatDowntimeSeconds": sla["infrastructure"]["heartbeatDowntimeSeconds"],
                },
                "outages": [_friend(o) for o in sla["outages"]],
                # 历史日快照（DailySla）；没有历史数据时为空数组
                "history": sla["history"],
                "updatedAt": sla["updatedAt"],
            }
            _status_cache_set(cache_key, payload)

        resp = Response(payload)
        resp["Cache-Control"] = "no-store"
        resp["X-Content-Type-Options"] = "nosniff"
        return resp


# ======================== 白标嵌入页 ========================

import hashlib
import hmac as _hmac


def _verify_embed_token(client_id: str, token: str, request=None) -> bool:
    """验证嵌入 token（timestamp.signature，5 分钟有效期）。

    同时校验 embed_allowed_origins：如果 client 配了白名单，来源必须在列表内；
    配置了白名单但拿不到 Origin/Referer 时按失败处理（fail-closed），避免白名单被绕过。
    空列表=允许全部（兼容现有集成商未配置的情况）。
    """
    from open_api.models import IntegrationClient

    token = token or ""
    client = IntegrationClient.objects.filter(id=client_id).first()
    if not client or not client.embed_token or not token:
        return False

    # Origin 白名单校验（配置后 fail-closed）
    if client.embed_allowed_origins:
        origin = ""
        if request is not None:
            origin = request.META.get("HTTP_ORIGIN") or request.META.get("HTTP_REFERER") or ""
        if not origin:
            return False
        allowed = [o.rstrip("/") for o in client.embed_allowed_origins if o]
        if origin.rstrip("/") not in allowed:
            return False

    parts = token.split(".")
    if len(parts) != 2:
        return False
    ts, sig = parts
    try:
        ts_int = int(ts)
    except ValueError:
        return False
    if abs(_time.time() - ts_int) > 300:
        return False

    def _sign(key: str) -> str:
        return _hmac.new(key.encode(), f"{client_id}.{ts}".encode(), hashlib.sha256).hexdigest()

    # 轮换宽限期：旧 token 在过渡期内仍然有效，避免集成商线上页面瞬间全挂
    from django.utils import timezone as _tz

    candidates = [client.embed_token]
    if client.embed_token_prev and client.embed_token_prev_expires_at:
        if client.embed_token_prev_expires_at > _tz.now():
            candidates.append(client.embed_token_prev)

    for key in candidates:
        if key and _hmac.compare_digest(_sign(key), sig):
            return True
    return False


def _regenerate_embed_token(client: IntegrationClient) -> str:
    """平台管理员点"重置嵌入 token"时调用。

    旧 token 写入 embed_token_prev，并给 5 分钟宽限期（集成商热切换）。
    """
    from datetime import timedelta

    from django.conf import settings
    from django.utils import timezone as _tz

    raw = f"{client.code}:{client.id}:{_time.time_ns()}:{settings.SECRET_KEY}"
    new_token = hashlib.sha256(raw.encode()).hexdigest()[:48]
    if client.embed_token:
        client.embed_token_prev = client.embed_token
        client.embed_token_prev_expires_at = _tz.now() + timedelta(minutes=5)
    else:
        client.embed_token_prev = ""
        client.embed_token_prev_expires_at = None
    client.embed_token = new_token
    client.save(update_fields=[
        "embed_token", "embed_token_prev", "embed_token_prev_expires_at",
    ])
    return client.embed_token


def _body(request) -> dict:
    """统一请求体键名为 snake_case。

    DRF 用 CamelCaseJSONParser 会把 camelCase 转 snake_case，但为了避免两套写法
    到处 if/else，这里再显式归一一次（两种命名都能取到）。
    """
    import re

    raw = request.data or {}
    if not hasattr(raw, "items"):
        return {}
    out = {}
    for key, value in raw.items():
        out[re.sub(r"(?<!^)(?=[A-Z])", "_", str(key)).lower()] = value
    return out


def _safe_color(value: str, fallback: str) -> str:
    """只允许 #RGB / #RRGGBB，防止把任意字符串拼进 CSS。"""
    import re

    if value and re.fullmatch(r"#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?", value):
        return value
    return fallback


def _render_embed_html(branding: dict, title: str, inner: str) -> str:
    """渲染可直接放进 iframe 的白标 HTML 片段（无外部依赖、内联 CSS）。

    所有用户可控字段（公司名 / 产品名 / logo）一律 html.escape，防止 XSS。
    """
    import html as _html

    from django.utils import timezone as _tz

    company = _html.escape(branding.get("companyName") or "")
    product = _html.escape(branding.get("productName") or "集成中台")
    logo = _html.escape(branding.get("logoUrl") or "")
    primary = _safe_color(branding.get("primaryColor") or "", "#3B82F6")
    secondary = _safe_color(branding.get("secondaryColor") or "", "#1E40AF")
    logo_html = f'<img class="logo" src="{logo}" alt="" />' if logo else ""

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{_html.escape(title)}</title>
<style>
  :root {{ --primary: {primary}; --secondary: {secondary}; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; padding: 16px; font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
         background: #F8FAFC; color: #0F172A; }}
  .card {{ background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 18px; box-shadow: 0 1px 2px rgba(15,23,42,.06); }}
  .head {{ display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }}
  .logo {{ height: 28px; width: auto; max-width: 160px; object-fit: contain; }}
  .brand {{ font-size: 13px; color: #64748B; }}
  .title {{ font-size: 15px; font-weight: 600; }}
  .row {{ display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #E2E8F0; font-size: 13px; }}
  .row:last-child {{ border-bottom: none; }}
  .k {{ color: #64748B; }}
  .v {{ font-weight: 600; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }}
  .ok {{ background: #DCFCE7; color: #166534; }}
  .warn {{ background: #FEF3C7; color: #92400E; }}
  .bar {{ height: 8px; border-radius: 999px; background: #E2E8F0; overflow: hidden; margin-top: 6px; }}
  .bar > i {{ display: block; height: 100%; background: var(--primary); }}
  .foot {{ margin-top: 12px; font-size: 11px; color: #94A3B8; }}
</style>
</head>
<body>
<div class="card">
  <div class="head">
    {logo_html}
    <div>
      <div class="title">{product}</div>
      <div class="brand">{company}</div>
    </div>
  </div>
  {inner}
  <div class="foot">数据更新于 {_html.escape(_tz.now().strftime("%Y-%m-%d %H:%M"))}</div>
</div>
</body>
</html>"""


def _embed_sla_html(branding: dict, sla: dict):
    """SLA 嵌入卡片（HTML 模式）。"""
    from django.http import HttpResponse

    info = sla["sla"]
    operational = info["status"] == "operational"
    rows = [
        ("30 天可用性", f'{info["achieved"]}%'),
        ("执行成功率", f'{sla["executions"]["successRate"]}%'),
        ("执行总数", f'{sla["executions"]["total"]}'),
        ("失败数", f'{sla["executions"]["failed"]}'),
        ("平均耗时", f'{int(sla["executions"]["avgDurationMs"])} ms'),
        ("不可用时長", f'{info["downtimeSeconds"]} s（预算 {info["budgetSeconds"]} s）'),
    ]
    inner = (
        f'<div class="row"><span class="k">当前状态</span>'
        f'<span class="badge {"ok" if operational else "warn"}">'
        f'{"运行正常" if operational else "服务降级"}</span></div>'
    )
    for key, val in rows:
        inner += f'<div class="row"><span class="k">{key}</span><span class="v">{val}</span></div>'

    outages = sla.get("outages") or []
    if outages:
        inner += '<div style="margin-top:14px;font-size:12px;color:#64748B;font-weight:600;">最近故障</div>'
        for outage in outages[:3]:
            inner += (
                f'<div class="row"><span class="k">{outage["start"][:16].replace("T", " ")}</span>'
                f'<span class="v">{outage["duration_seconds"]} s</span></div>'
            )

    resp = HttpResponse(
        _render_embed_html(branding, "服务状态", inner),
        content_type="text/html; charset=utf-8",
    )
    resp["Content-Security-Policy"] = "frame-ancestors *"
    return resp


def _embed_usage_html(branding: dict, usage: dict):
    """用量嵌入卡片（HTML 模式）：进度条按配额百分比着色。"""
    from django.http import HttpResponse

    def bar(label: str, used: int, limit: int, percent: float, unit: str) -> str:
        quota = f"{limit:,}" if limit else "不限"
        return (
            f'<div style="margin-bottom:14px;">'
            f'<div class="row" style="border:none;padding-bottom:2px;">'
            f'<span class="k">{label}</span>'
            f'<span class="v">{used:,} / {quota} {unit}</span></div>'
            f'<div class="bar"><i style="width:{min(percent, 100)}%;'
            f'background:{"#EF4444" if percent >= 90 else "#F59E0B" if percent >= 70 else "var(--primary)"};"></i></div>'
            f'</div>'
        )

    inner = (
        f'<div class="row"><span class="k">统计周期</span><span class="v">{usage["period"]}</span></div>'
        + bar("数据行写入", usage["rowsWritten"], usage["rowsLimit"], usage["rowsPercent"], "行")
        + bar("API 调用", usage["apiCalls"], usage["apiCallsLimit"], usage["apiCallsPercent"], "次")
    )
    resp = HttpResponse(
        _render_embed_html(branding, "用量", inner),
        content_type="text/html; charset=utf-8",
    )
    resp["Content-Security-Policy"] = "frame-ancestors *"
    return resp


class ClientBrandingView(APIView):
    """获取/更新某个 client 的白标配置。GET 公开（嵌入页用），PUT 需登录。"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def dispatch(self, request, *args, **kwargs):
        # DRF 在 initialize_request 阶段就取 authentications/permissions，
        # 那时 self.request 还没赋值，因此这里先缓存原始 method。
        self._http_method = request.method
        return super().dispatch(request, *args, **kwargs)

    def get_authenticators(self):
        if getattr(self, "_http_method", None) == "PUT":
            return [ApiKeyAuthentication(), JWTAuthentication()]
        return []

    def get_permissions(self):
        return [IsAuthenticated()] if getattr(self, "_http_method", None) == "PUT" else [AllowAny()]

    def get(self, request):
        from open_api.models import IntegrationClient

        client_id = q(request, "clientId")
        if not client_id:
            raise ApiError("需要 clientId", 400)
        client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("client 不存在", 404)
        return _harden_public_response(Response({
            "clientId": client.id,
            "clientCode": client.code,
            "companyName": client.branding_company_name or client.name,
            "productName": client.branding_product_name or "集成中台",
            "logoUrl": client.branding_logo_url,
            "logoDarkUrl": client.branding_logo_dark_url,
            "primaryColor": client.branding_primary_color or "#3B82F6",
            "secondaryColor": client.branding_secondary_color or "#1E40AF",
        }))

    def put(self, request):
        """更新白标配置（需登录）。非平台账号只能改自己的 client。"""
        from open_api.models import IntegrationClient
        from core.tenancy import is_platform

        data = _body(request)
        client_id = data.get("client_id") or principal_client_id(request)
        if not client_id:
            raise ApiError("需要 clientId", 400)
        client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("client 不存在", 404)
        if not is_platform(request) and client_id != principal_client_id(request):
            raise ApiError("无权修改其他客户的白标配置", 403)

        # 颜色只接受 #RGB / #RRGGBB，避免把任意字符串写进 CSS
        for field, color in (
            ("branding_primary_color", data.get("primary_color")),
            ("branding_secondary_color", data.get("secondary_color")),
        ):
            if color is not None:
                setattr(client, field, _safe_color(color, getattr(client, field) or ""))
        for field, key in (
            ("branding_company_name", "company_name"),
            ("branding_product_name", "product_name"),
            ("branding_logo_url", "logo_url"),
            ("branding_logo_dark_url", "logo_dark_url"),
        ):
            if key in data:
                setattr(client, field, data.get(key) or "")
        if "allowed_origins" in data:
            client.embed_allowed_origins = _as_list(data.get("allowed_origins"))
        client.save()
        return Response({
            "clientId": client.id,
            "companyName": client.branding_company_name or client.name,
            "productName": client.branding_product_name or "集成中台",
            "logoUrl": client.branding_logo_url,
            "logoDarkUrl": client.branding_logo_dark_url,
            "primaryColor": client.branding_primary_color or "#3B82F6",
            "secondaryColor": client.branding_secondary_color or "#1E40AF",
            "allowedOrigins": client.embed_allowed_origins,
        })


def _embed_rate_limited(request) -> bool:
    """嵌入端点按 IP 限流（默认 120 次/分钟）。"""
    from core.throttling import check_public_rate_limit

    allowed, _wait = check_public_rate_limit(_public_client_ip(request), "embed", limit=120)
    return not allowed


def _harden_public_response(resp):
    """公开 / 嵌入响应统一加固：禁止缓存、禁止 MIME 嗅探、允许 iframe 嵌入。"""
    resp["Cache-Control"] = "no-store"
    resp["X-Content-Type-Options"] = "nosniff"
    resp["Referrer-Policy"] = "no-referrer"
    resp["Content-Security-Policy"] = "frame-ancestors *"
    return resp


class EmbedSlaView(APIView):
    """嵌入页：集成商 iframe 到自己控制台的 SLA 状态卡片。

    签名 token 格式: embed_token?client_id=xxx&token=yyy
    （避免 JWT 过期问题，独立的轻量签名）
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from open_api.models import IntegrationClient
        from monitor.sla import compute_sla

        if _embed_rate_limited(request):
            raise ApiError("请求过于频繁，请稍后再试", 429)
        client_id = q(request, "clientId")
        token = q(request, "token")
        if not client_id or not token or not _verify_embed_token(client_id, token, request):
            raise ApiError("无效或过期的嵌入 token", 403)
        client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("client 不存在", 404)

        sla = compute_sla(days=30, client_id=client_id)
        branding = {
            "companyName": client.branding_company_name or client.name,
            "productName": client.branding_product_name or "集成中台",
            "logoUrl": client.branding_logo_url,
            "primaryColor": client.branding_primary_color or "#3B82F6",
            "secondaryColor": client.branding_secondary_color or "#1E40AF",
        }
        if q(request, "output") == "html":
            return _harden_public_response(_embed_sla_html(branding, sla))
        return _harden_public_response(Response({
            "client": {"id": client.id, "code": client.code},
            "branding": branding,
            "sla": sla,
        }))


class EmbedUsageView(APIView):
    """嵌入页：集成商看自己的用量。"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from open_api.models import IntegrationClient, ClientUsageDaily

        if _embed_rate_limited(request):
            raise ApiError("请求过于频繁，请稍后再试", 429)
        client_id = q(request, "clientId")
        token = q(request, "token")
        if not client_id or not token or not _verify_embed_token(client_id, token, request):
            raise ApiError("无效或过期的嵌入 token", 403)

        import calendar
        from datetime import date
        today = date.today()
        first = today.replace(day=1)
        last_day = calendar.monthrange(today.year, today.month)[1]
        last = today.replace(day=last_day)

        from django.db.models import Sum
        rows_this_month = ClientUsageDaily.objects.filter(
            client_id=client_id, day__gte=first, day__lte=last,
        ).aggregate(total=Sum("rows_written"))["total"] or 0
        calls_this_month = ClientUsageDaily.objects.filter(
            client_id=client_id, day__gte=first, day__lte=last,
        ).aggregate(total=Sum("api_calls"))["total"] or 0

        from open_api.entitlements import effective_limits
        limits = effective_limits(client_id)
        # effective_limits 的 0 表示该维度不限（无授权记录 / 私有化默认全开）
        rows_limit = int(limits.get("max_rows_monthly") or 0)
        calls_limit = int(limits.get("max_api_calls_monthly") or 0)

        def _pct(used: int, limit: int) -> float:
            return round(min(used / limit, 1) * 100, 1) if limit else 0.0

        payload = {
            "rowsWritten": rows_this_month,
            "rowsLimit": rows_limit,
            "rowsPercent": _pct(rows_this_month, rows_limit),
            "apiCalls": calls_this_month,
            "apiCallsLimit": calls_limit,
            "apiCallsPercent": _pct(calls_this_month, calls_limit),
            "period": f"{today.year}-{today.month:02d}",
        }

        if q(request, "output") == "html":
            from open_api.models import IntegrationClient as _IC

            client = _IC.objects.filter(id=client_id).first()
            branding = {
                "companyName": (client.branding_company_name or client.name) if client else "",
                "productName": (client.branding_product_name or "集成中台") if client else "集成中台",
                "logoUrl": client.branding_logo_url if client else "",
                "primaryColor": client.branding_primary_color if client else "",
                "secondaryColor": client.branding_secondary_color if client else "",
            }
            return _harden_public_response(_embed_usage_html(branding, payload))

        return _harden_public_response(Response(payload))


class ClientEmbedTokenView(APIView):
    """重置某个 client 的 embed_token + 生成有效 5 分钟的 token 示例值。

    安全：必须鉴权，且只能平台账号或该 client 自己的 Key/JWT 操作。
    """

    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]

    def post(self, request):
        from open_api.models import IntegrationClient
        from core.tenancy import is_platform

        client_id = (request.data or {}).get("client_id") or principal_client_id(request)
        if not client_id:
            raise ApiError("需要 clientId", 400)
        client = IntegrationClient.objects.filter(id=client_id).first()
        if not client:
            raise ApiError("client 不存在", 404)
        # tenant 隔离：非平台账号只能重置自己的 embed_token
        if not is_platform(request) and client_id != principal_client_id(request):
            raise ApiError("无权重置其他客户的 embed_token", 403)
        new_token = _regenerate_embed_token(client)
        # 返回一个示例签名（平台自己能算，方便集成商测试）
        ts = str(int(_time.time()))
        sig = _hmac.new(
            new_token.encode(),
            f"{client_id}.{ts}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return Response({
            "embedToken": new_token,
            "exampleToken": f"{ts}.{sig}",
            "validMinutes": 5,
            "usage": f"GET /api/embed/sla?clientId={client_id}&token={ts}.{sig}",
        })

