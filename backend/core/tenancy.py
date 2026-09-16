"""
多租户隔离中央层（SaaS / 私有化共同的安全底线）。

请求主体三类：
- 平台运营账号：JWT 用户且 client_id=""，可见全站；
- 客户账号：JWT 用户 client_id=ic_*，只能访问本客户资源，禁止看全站；
- API Key：auth_ctx.client 非空，与客户账号同等约束。

强制规则：
- 列表 / 统计：一律 scope_qs 收敛到主体客户；
- 对象直链：get_object_or_owned 对无归属记录统一返回 404，杜绝改 id 越权；
- 创建 / 更新：client_id 只取自服务端主体（resolve_create_client_id），
  前端或集成商传入的 clientId 对客户主体不可信；平台账号可指派给已存在客户。

两种部署模式（DEPLOYMENT_MODE）下本隔离都生效；区别仅在配额超限的处理。
"""
from __future__ import annotations

from core.exceptions import ApiError

# 通过任务间接挂客户的表
JOB_LINKED_MODELS = {
    "JobExecution",
    "DeadLetterMessage",
    "FieldChangeAudit",
    "DataVersionSnapshot",
    "WorkflowRun",
    "Department",
    "UserDepartment",
    "DeptSyncExecution",
}
# 通过应用间接挂客户的表
APP_LINKED_MODELS = {"SsoSession", "SsoAuditLog"}


def auth_ctx(request):
    return getattr(request, "auth_ctx", None)


def principal_client_id(request) -> str:
    """主体所属客户 ID。API Key 取凭证 id；JWT 取用户 client_id；未认证为空。"""
    ctx = auth_ctx(request)
    if ctx is None:
        return ""
    client = getattr(ctx, "client", None)
    if client is not None:
        return str(getattr(client, "id", "") or "")
    user = getattr(ctx, "user", None)
    if user is not None:
        return str(getattr(user, "client_id", "") or "")
    return str(getattr(ctx, "client_id", "") or "")


def is_api_key(request) -> bool:
    ctx = auth_ctx(request)
    return ctx is not None and getattr(ctx, "client", None) is not None


def is_platform(request) -> bool:
    """平台运营账号：已认证的 JWT 用户且不属于任何客户。API Key 永远不是平台主体。"""
    ctx = auth_ctx(request)
    if ctx is None or getattr(ctx, "client", None) is not None:
        return False
    return not principal_client_id(request)


def assert_platform(request, message: str = "仅平台运营账号可操作") -> None:
    if not is_platform(request):
        raise ApiError(message, 403, code="FORBIDDEN_TENANT")


def client_job_ids(client_id: str):
    from jobs.models import IntegrationJob

    return IntegrationJob.objects.filter(client_id=client_id).values_list("id", flat=True)


def client_app_ids(client_id: str):
    from sso.models import Application

    return Application.objects.filter(client_id=client_id).values_list("id", flat=True)


def scope_qs(qs, request):
    """把任意资源 QuerySet 强制收敛到请求主体的客户范围。平台主体不过滤。"""
    cid = principal_client_id(request)
    if not cid:
        return qs
    model = qs.model
    if hasattr(model, "client_id"):
        return qs.filter(client_id=cid)
    label = model.__name__
    if label in JOB_LINKED_MODELS and hasattr(model, "job_id"):
        return qs.filter(job_id__in=client_job_ids(cid))
    if label in APP_LINKED_MODELS and hasattr(model, "app_id"):
        return qs.filter(app_id__in=client_app_ids(cid))
    # 未知归属的表：失败关闭，客户主体默认不可见
    return qs.none()


def get_owned(model, pk, request, *, qs=None, not_found: str = "资源不存在"):
    """按主键取对象并做归属校验；不可见与不存在统一 404。"""
    base = qs if qs is not None else model.objects
    obj = base.filter(id=pk).first()
    if obj is None:
        raise ApiError(not_found, 404, code="NOT_FOUND")
    assert_object_owned(obj, request, not_found=not_found)
    return obj


def assert_object_owned(obj, request, *, not_found: str = "资源不存在") -> None:
    cid = principal_client_id(request)
    if not cid:
        return
    model_name = obj.__class__.__name__
    if hasattr(obj, "client_id"):
        if str(getattr(obj, "client_id", "") or "") == cid:
            return
        raise ApiError(not_found, 404, code="NOT_FOUND")
    if model_name in JOB_LINKED_MODELS and hasattr(obj, "job_id"):
        from jobs.models import IntegrationJob

        job = IntegrationJob.objects.filter(id=obj.job_id).first()
        if job and (job.client_id or "") == cid:
            return
        raise ApiError(not_found, 404, code="NOT_FOUND")
    if model_name in APP_LINKED_MODELS and hasattr(obj, "app_id"):
        from sso.models import Application

        app = Application.objects.filter(id=obj.app_id).first()
        if app and (app.client_id or "") == cid:
            return
        raise ApiError(not_found, 404, code="NOT_FOUND")
    # 无法判定归属的对象：客户主体失败关闭
    raise ApiError(not_found, 404, code="NOT_FOUND")


def resolve_create_client_id(request, data: dict | None = None) -> str:
    """
    解析创建/指派时的目标客户。
    - 客户主体 / API Key：强制回本客户，忽略请求体里的 clientId；
    - 平台账号：可取请求体指派，但必须是已存在客户，禁止伪造。
    """
    cid = principal_client_id(request)
    if cid:
        return cid
    data = data or {}
    target = str(data.get("client_id") or data.get("clientId") or "").strip()
    if not target:
        return ""
    from open_api.models import IntegrationClient

    if not IntegrationClient.objects.filter(id=target).exists():
        raise ApiError("所属客户不存在", 400, code="VALIDATION")
    return target
