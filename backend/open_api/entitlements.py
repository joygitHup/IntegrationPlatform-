"""
客户授权（配额）门禁。

授权表 sys_client_entitlements：任务数 / 席位 / 连接器 / 月行数 / 月调用次数。
所有上限 0 = 不限；没有授权记录时按全 0 处理 —— 私有化部署开箱即用。

超限策略按部署模式分流（数据隔离则两模式都强制，见 core/tenancy）：
- SaaS：硬拒绝（资源 403 ENTITLEMENT_EXCEEDED；月度用量 429 QUOTA_EXCEEDED）；
- 私有化：放行 + 告警（open_api.quota_alerts，每天每客户每指标一次）。
"""
from __future__ import annotations

from core.env import is_saas
from core.exceptions import ApiError

RESOURCE_METRICS = {
    "jobs": ("max_jobs", "集成任务数"),
    "seats": ("max_seats", "席位数"),
    "connectors": ("max_connectors", "连接器（数据源）数"),
}

LIMIT_FIELDS = (
    "max_jobs",
    "max_seats",
    "max_connectors",
    "max_rows_monthly",
    "max_api_calls_monthly",
)


def get_entitlement(client_id: str):
    if not client_id:
        return None
    from open_api.models import ClientEntitlement

    return ClientEntitlement.objects.filter(client_id=client_id).first()


def ensure_entitlement(client_id: str, **defaults):
    from open_api.models import ClientEntitlement

    if not client_id:
        return None
    obj = ClientEntitlement.objects.filter(client_id=client_id).first()
    if obj:
        # 已存在：合并 plan / expires_at / 配额字段（None 不覆盖）
        from datetime import datetime as _dt
        if "plan" in defaults and defaults["plan"]:
            obj.plan = str(defaults["plan"])
        if "expires_at" in defaults and defaults["expires_at"] is not None:
            obj.expires_at = defaults["expires_at"]
        for field in LIMIT_FIELDS:
            if field in defaults and defaults[field]:
                setattr(obj, field, max(0, int(defaults[field])))
        if "plan_features_json" in defaults and defaults["plan_features_json"]:
            obj.plan_features_json = defaults["plan_features_json"]
        obj.save()
        return obj
    # 新建：pick 所有合法字段
    create_kwargs = {k: v for k, v in defaults.items() if k in LIMIT_FIELDS or k in ("plan", "expires_at", "plan_features_json")}
    return ClientEntitlement.objects.create(client_id=client_id, **create_kwargs)


def update_entitlement(client_id: str, values: dict):
    obj = ensure_entitlement(client_id)
    for field in LIMIT_FIELDS:
        if field in values and values[field] is not None:
            setattr(obj, field, max(0, int(values[field])))
    if "note" in values:
        obj.note = str(values.get("note") or "")[:255]
    obj.save()
    return obj


def effective_limits(client_id: str) -> dict:
    """无授权记录 = 全部 0（不限），私有化直接用。

    私有化模式 + 存在 license.json 时，license 配额是硬性上限——DB 不能超 license。
    SaaS 模式跳过 license 校验（在线计费由 SaaS 自己的系统管）。
    """
    ent = get_entitlement(client_id)
    if ent is None:
        limits = {field: 0 for field in LIMIT_FIELDS}
    else:
        limits = {field: int(getattr(ent, field) or 0) for field in LIMIT_FIELDS}

    # 私有化 + 有 license 时做 min() 夹逼
    if client_id and not is_saas():
        try:
            from django.conf import settings

            from core.license import _license_path

            lic_path = _license_path()
            if lic_path.is_file():
                from core.license import get_effective_entitlements

                lic = get_effective_entitlements(client_id)
                for field in LIMIT_FIELDS:
                    lic_val = lic.get(field, 0)
                    if lic_val:  # license 里 0 表示该维度不限，不参与 min
                        limits[field] = min(limits.get(field, 0) or lic_val, lic_val)
        except Exception:
            # license 校验异常不阻断业务
            pass

    return limits


def current_counts(client_id: str) -> dict:
    from datasources.models import Datasource
    from iam.models import User
    from jobs.models import IntegrationJob

    return {
        "jobs": IntegrationJob.objects.filter(client_id=client_id).count(),
        "connectors": Datasource.objects.filter(client_id=client_id).count(),
        "seats": User.objects.filter(client_id=client_id, status="active").count(),
    }


def _get_client(client_id: str):
    from open_api.models import IntegrationClient

    return IntegrationClient.objects.filter(id=client_id).first()


def _deny_or_alert(client, metric: str, *, used: int, limit: int, status: int, code: str, message: str, raise_on_deny: bool = True, client_id: str | None = None) -> bool:
    if is_saas():
        if raise_on_deny:
            raise ApiError(message, status, code=code)
        return False
    from open_api.quota_alerts import alert_over_quota

    alert_over_quota(client, metric, used=used, limit=limit, client_id=client_id or (str(getattr(client, "id", "") or "") if client is not None else ""))
    return True


def gate_resource(client_id: str, kind: str, *, delta: int = 1) -> None:
    """创建类资源（任务 / 席位 / 连接器）数量门禁。"""
    if not client_id or kind not in RESOURCE_METRICS:
        return
    field, label = RESOURCE_METRICS[kind]
    limit = effective_limits(client_id).get(field, 0)
    if not limit:
        return
    used = current_counts(client_id).get(kind, 0)
    if used + delta <= limit:
        return
    client = _get_client(client_id)
    _deny_or_alert(
        client,
        kind,
        used=used,
        limit=limit,
        status=403,
        code="ENTITLEMENT_EXCEEDED",
        message=f"授权{label}已达上限（{limit}），请联系中台运营扩容",
        client_id=client_id,
    )


def gate_seats_on_toggle(client_id: str, becoming_active: bool) -> None:
    """把停用席位重新启用时同样受席位门禁约束。"""
    if becoming_active:
        gate_resource(client_id, "seats")


def monthly_usage(client_id: str) -> dict:
    from open_api.usage import month_totals

    return month_totals(client_id)


def gate_rows(client_id: str, incoming_rows: int, *, raise_on_deny: bool = True) -> bool:
    """
    写入前行数门禁。返回是否允许写入（私有化超限也放行）。
    SaaS 超限：raise_on_deny=True 抛 QUOTA_EXCEEDED；False 时返回 False（供执行器收口）。
    """
    if not client_id or incoming_rows <= 0:
        return True
    limit = effective_limits(client_id).get("max_rows_monthly", 0)
    if not limit:
        return True
    used = monthly_usage(client_id).get("rowsWritten", 0)
    if used + incoming_rows <= limit:
        return True
    client = _get_client(client_id)
    return _deny_or_alert(
        client,
        "rows",
        used=used + incoming_rows,
        limit=limit,
        status=429,
        code="QUOTA_EXCEEDED",
        message=f"本月写入行数将超过授权上限（{limit}），请联系中台运营扩容",
        raise_on_deny=raise_on_deny,
        client_id=client_id,
    )


def gate_api_calls(client_id: str) -> None:
    """请求入口月度调用次数门禁（API Key 认证、客户 JWT 认证时调用）。"""
    if not client_id:
        return
    limit = effective_limits(client_id).get("max_api_calls_monthly", 0)
    if not limit:
        return
    used = monthly_usage(client_id).get("apiCalls", 0)
    # 当前这次请求计入后超限才拦截
    if used + 1 <= limit:
        return
    client = _get_client(client_id)
    _deny_or_alert(
        client,
        "api_calls",
        used=used + 1,
        limit=limit,
        status=429,
        code="QUOTA_EXCEEDED",
        message=f"本月 API 调用次数已达授权上限（{limit}），请联系中台运营扩容",
        client_id=client_id,
    )


def entitlement_payload(client_id: str) -> dict:
    limits = effective_limits(client_id)
    counts = current_counts(client_id) if client_id else {"jobs": 0, "connectors": 0, "seats": 0}
    month = monthly_usage(client_id) if client_id else {"apiCalls": 0, "rowsWritten": 0}
    ent = get_entitlement(client_id)
    return {
        "plan": get_plan(client_id),
        "expiresAt": ent.expires_at.isoformat() if ent and ent.expires_at else None,
        "limits": {
            "maxJobs": limits["max_jobs"],
            "maxSeats": limits["max_seats"],
            "maxConnectors": limits["max_connectors"],
            "maxRowsMonthly": limits["max_rows_monthly"],
            "maxApiCallsMonthly": limits["max_api_calls_monthly"],
        },
        "used": {
            "jobs": counts["jobs"],
            "seats": counts["seats"],
            "connectors": counts["connectors"],
            "monthlyRows": month["rowsWritten"],
            "monthlyApiCalls": month["apiCalls"],
        },
        "deploymentMode": "saas" if is_saas() else "private",
    }


# ===== Plan / Feature Gate =====

# Trial plan 禁止的 feature 映射。每个 feature 是业务含义键，在具体入口处消费。
_TRIAL_BLOCKS_FEATURES = {
    # 环境
    "environment_prod": "试用版只允许 dev 环境",
    "environment_staging": "试用版只允许 dev 环境",
    # SSO 登录方式（试用版只开放 JWT）
    "sso_oauth2": "试用版 SSO 仅支持 JWT 模式",
    "sso_saml": "试用版 SSO 仅支持 JWT 模式",
    "sso_ticket": "试用版 SSO 仅支持 JWT 模式",
    "sso_form_based": "试用版 SSO 仅支持 JWT 模式",
}


def get_plan(client_id: str) -> str:
    """返回 client 的订阅计划。无 ClientEntitlement 时返回 'standard'（向后兼容旧数据）。"""
    if not client_id:
        return "standard"
    ent = get_entitlement(client_id)
    if ent is None:
        return "standard"
    return (ent.plan or "standard").strip().lower() or "standard"


def plan_deny_reason(client_id: str, feature: str) -> str | None:
    """trial plan 禁止 feature 时返回中文说明；正式版或通过 plan_features_json 覆写放行时返回 None。"""
    plan = get_plan(client_id)
    if plan != "trial":
        return None
    ent = get_entitlement(client_id)
    if ent and isinstance(ent.plan_features_json, dict) and ent.plan_features_json.get(feature):
        return None
    return _TRIAL_BLOCKS_FEATURES.get(feature)


def check_plan_feature(client_id: str, feature: str) -> None:
    """trial plan 禁止的 feature：抛 ApiError(403, code=PLAN_DENIED)；否则放行。"""
    reason = plan_deny_reason(client_id, feature)
    if reason:
        raise ApiError(reason, http_status=403, code="PLAN_DENIED")
