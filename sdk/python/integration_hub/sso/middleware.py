"""统一中间件：自动识别 URL 参数类型并建会话。

  Django:
      MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]

  Flask:
      app = integration_hub.sso.middleware.flask_callback(app)

  路由约定（统一约定）：
      /sso/callback?token=xxx       -> jwt 模式（本地 RS256 验签 + 回调兜底）
      /sso/callback?ticket=xxx      -> ticket 模式（一次性消费）
      /sso/callback?code=xxx        -> oauth2 模式（P2 接入，调 /api/oauth/token）
      /sso/callback?SAMLResponse=xx -> saml 模式（P3 接入，解析断言）

  会话约定：
      用户映射策略（auto_create_user=true 时自动建本地账号；否则按 username 查现有）
      成功后写入 request.session[local_session_key] = local_user.id
      清除 URL token（window.history.replaceState）跳到 redirect 或 default_redirect
"""
from __future__ import annotations

from . import get_config
from .jwt_mode import verify_token
from .ticket_mode import consume_ticket


def _build_redirect_url(redirect: str | None) -> str:
    cfg = get_config()
    return redirect or cfg["default_redirect"]


def _map_or_create_user(user_info: dict):
    """子类化重写。默认返回 user_info（不做本地映射）。"""
    return user_info


def handle_callback(params: dict):
    """通用回调处理器：返回 (user_info dict | None, redirect_url)。

    params 是合并 GET + POST 的 dict。
    """
    cfg = get_config()
    if params.get("token"):
        user_info = verify_token(params["token"])
    elif params.get("ticket"):
        user_info = consume_ticket(params["ticket"])
    elif params.get("code"):
        # OAuth2 模式：P2 接入，此处先返回 None 占位
        from .oauth2_mode import exchange_code
        user_info = exchange_code(params["code"], params.get("state", ""))
    elif params.get("SAMLResponse"):
        # SAML 模式：P3 接入
        from .saml_mode import parse_assertion
        user_info = parse_assertion(params["SAMLResponse"])
    else:
        user_info = None
    redirect = _build_redirect_url(params.get("redirect"))
    return user_info, redirect


def django_sso_callback(get_response):
    """Django 中间件：自动处理 /sso/callback?token=xxx。"""
    from django.shortcuts import redirect

    def middleware(request):
        if request.path.rstrip("/") == "/sso/callback":
            params = {}
            params.update({k: v for k, v in request.GET.items()})
            if request.method == "POST":
                params.update({k: v for k, v in request.POST.items()})
            user_info, redirect_url = handle_callback(params)
            if user_info:
                local_user = _map_or_create_user(user_info)
                if local_user is not None:
                    user_id = (
                        getattr(local_user, "id", None)
                        or (local_user.get("id") if isinstance(local_user, dict) else None)
                        or user_info.get("sub")
                    )
                    request.session[get_config()["local_session_key"]] = user_id
                    return redirect(redirect_url)
            return redirect("/login")
        return get_response(request)
    return middleware


def flask_callback(app):
    """Flask 蓝图：在 Flask app 上注册 /sso/callback 路由。"""
    from flask import request, redirect, session

    @app.route("/sso/callback", methods=["GET", "POST"])
    def _sso_callback():
        params = {**request.args.to_dict(), **request.form.to_dict()}
        user_info, redirect_url = handle_callback(params)
        if user_info:
            local_user = _map_or_create_user(user_info)
            if local_user is not None:
                user_id = (
                    getattr(local_user, "id", None)
                    or (local_user.get("id") if isinstance(local_user, dict) else None)
                    or user_info.get("sub")
                )
                session[get_config()["local_session_key"]] = user_id
                return redirect(redirect_url)
        return redirect("/login")
    return app


def fastapi_callback():
    """FastAPI 路由：from integration_hub.sso.middleware import fastapi_callback
    app.include_router(fastapi_callback())

    注意：需先挂 Starlette SessionMiddleware 才能写 session：
        from starlette.middleware.sessions import SessionMiddleware
        app.add_middleware(SessionMiddleware, secret_key="<随机串>")
    """
    from fastapi import APIRouter, Request
    from fastapi.responses import RedirectResponse

    router = APIRouter()

    @router.get("/sso/callback")
    @router.post("/sso/callback")
    async def _cb(request: Request):
        params = dict(request.query_params)
        try:
            form = await request.form()
            params.update({k: v for k, v in form.items()})
        except Exception:
            pass
        user_info, redirect_url = handle_callback(params)
        if user_info:
            local_user = _map_or_create_user(user_info)
            if local_user is not None:
                user_id = (
                    getattr(local_user, "id", None)
                    or (local_user.get("id") if isinstance(local_user, dict) else None)
                    or user_info.get("sub")
                )
                resp = RedirectResponse(redirect_url)
                if hasattr(request, "session"):
                    request.session[get_config()["local_session_key"]] = user_id
                else:
                    # 未挂 SessionMiddleware 时降级为 cookie（调用方自行读取）
                    resp.set_cookie(
                        get_config()["local_session_key"],
                        str(user_id), httponly=True, samesite="lax",
                    )
                return resp
        return RedirectResponse("/login")
    return router


def django_sso_callback_view(request):
    """Django 函数视图（与中间件二选一，推荐不想加全局中间件的系统使用）：

        # urls.py
        from integration_hub.sso.middleware import django_sso_callback_view
        urlpatterns += [path("sso/callback", django_sso_callback_view)]
    """
    from django.http import HttpResponseRedirect
    from django.views.decorators.csrf import csrf_exempt

    @csrf_exempt
    def _view(req):
        params = dict(req.GET.items())
        if req.method == "POST":
            params.update(dict(req.POST.items()))
        user_info, redirect_url = handle_callback(params)
        if user_info:
            local_user = _map_or_create_user(user_info)
            if local_user is not None:
                user_id = (
                    getattr(local_user, "id", None)
                    or (local_user.get("id") if isinstance(local_user, dict) else None)
                    or user_info.get("sub")
                )
                req.session[get_config()["local_session_key"]] = user_id
                return HttpResponseRedirect(redirect_url)
        return HttpResponseRedirect("/login")

    return _view(request)
