"""运行环境隔离：dev / staging / prod。"""
from __future__ import annotations

from django.conf import settings

VALID_ENVS = ("dev", "staging", "prod")
VALID_DEPLOYMENT_MODES = ("private", "saas")


def deployment_mode() -> str:
    """private=私有化部署（默认）；saas=SaaS 运营。"""
    value = (getattr(settings, "DEPLOYMENT_MODE", None) or "private").strip().lower()
    return value if value in VALID_DEPLOYMENT_MODES else "private"


def is_saas() -> bool:
    return deployment_mode() == "saas"


def default_environment() -> str:
    value = (getattr(settings, "ENVIRONMENT", None) or "dev").strip().lower()
    return value if value in VALID_ENVS else "dev"


def request_environment(request=None) -> str:
    if request is None:
        return default_environment()
    header = (request.META.get("HTTP_X_ENVIRONMENT") or "").strip().lower()
    query = ""
    try:
        query = (request.GET.get("env") or request.GET.get("environment") or "").strip().lower()
    except Exception:
        pass
    value = header or query or default_environment()
    return value if value in VALID_ENVS else default_environment()


def query_environment(request=None) -> str:
    """控制台列表只用查询参数过滤环境。默认 X-Environment=dev 不得把 prod 资产藏掉。"""
    if request is None:
        return ""
    try:
        value = (request.GET.get("env") or request.GET.get("environment") or "").strip().lower()
    except Exception:
        return ""
    return value if value in VALID_ENVS else ""


def assert_same_env(*objs) -> None:
    envs = {getattr(o, "environment", "") or default_environment() for o in objs if o is not None}
    if len(envs) > 1:
        from core.exceptions import ApiError

        raise ApiError("数据源 / 任务 / 应用必须处于同一运行环境", 400)
