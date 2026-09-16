"""SSO 引擎：JWT / Ticket / OAuth2 / SAML / 表单代填。"""
from __future__ import annotations

from datetime import timedelta
from urllib.parse import quote, urlencode

import jwt
from django.utils import timezone

from core.encryption import encrypt
from core.exceptions import ApiError
from core.ids import generate_id
from sso.models import Application, SsoAuditLog, SsoSession, SsoTicket, UserAppBinding


def get_app(id_or_code: str) -> Application:
    if not id_or_code:
        raise ApiError("缺少应用标识", 400)
    app = (
        Application.objects.filter(id=id_or_code).first()
        or Application.objects.filter(code=id_or_code).first()
    )
    if not app:
        raise ApiError("应用不存在", 404)
    return app


def record_sso_audit(**kwargs) -> SsoAuditLog:
    return SsoAuditLog.objects.create(**{k: v for k, v in kwargs.items() if v is not None})


def _check_whitelist(app: Application, ip: str | None) -> None:
    if app.ip_whitelist_enabled and app.ip_whitelist and ip:
        if ip not in app.ip_whitelist:
            raise ApiError("IP 不在白名单内", 403)


def initiate_sso_login(app_id: str, user, *, redirect_path: str = "", ip: str = "", user_agent: str = "") -> dict:
    app = Application.objects.filter(id=app_id).first()
    if not app:
        raise ApiError("应用不存在", 404)
    if app.status != "active":
        raise ApiError("应用未启用", 400)
    _check_whitelist(app, ip)

    if app.login_type == "jwt":
        return _jwt_login(app, user, redirect_path, ip, user_agent)
    if app.login_type == "ticket":
        return _ticket_login(app, user, redirect_path, ip, user_agent)
    if app.login_type == "oauth2":
        from sso.oauth import start_authorization

        return start_authorization(app, user=user, redirect_uri="")
    if app.login_type == "saml":
        from sso.saml import start_authn

        return start_authn(app, relay_state=redirect_path)
    if app.login_type == "form_based":
        return _form_based_login(app, user, ip=ip, user_agent=user_agent)
    raise ApiError(f"不支持的登录方式: {app.login_type}", 400)


def _form_credentials(app, user) -> dict:
    import ast
    import json

    from core.encryption import decrypt
    from sso.models import UserAppBinding

    user_id = getattr(user, "id", "") or ""
    binding = UserAppBinding.objects.filter(user_id=user_id, app_id=app.id, status="active").first()
    raw = ""
    if binding and binding.encrypted_credentials:
        raw = decrypt(binding.encrypted_credentials)
    data: dict = {}
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            try:
                parsed = ast.literal_eval(raw)
            except (ValueError, SyntaxError):
                parsed = {}
        if isinstance(parsed, dict):
            data = parsed
        elif isinstance(parsed, str):
            data = {"password": parsed}
    username = (
        data.get("username")
        or data.get("user")
        or (binding.external_username if binding else "")
        or getattr(user, "username", "")
        or ""
    )
    password = data.get("password") or data.get("passwd") or ""
    extra = data.get("extra") if isinstance(data.get("extra"), dict) else {}
    return {"username": username, "password": password, "extra": extra, "bound": bool(binding and password)}


def _form_based_login(app, user, *, ip: str = "", user_agent: str = "") -> dict:
    import html as htmlmod

    settings = app.settings or {}
    user_field = settings.get("usernameField") or settings.get("username_field") or "username"
    pass_field = settings.get("passwordField") or settings.get("password_field") or "password"
    method = str(settings.get("method") or "POST").upper()
    if method not in ("GET", "POST"):
        method = "POST"
    creds = _form_credentials(app, user)
    if not creds["password"]:
        return {
            "type": "form_based",
            "needBinding": True,
            "loginUrl": app.login_url,
            "usernameField": user_field,
            "passwordField": pass_field,
            "error": "请先绑定该应用的账号密码",
        }
    fields = {user_field: creds["username"], pass_field: creds["password"], **creds["extra"]}
    extra_cfg = settings.get("extraFields") or settings.get("extra_fields") or {}
    if isinstance(extra_cfg, dict):
        fields.update({str(k): str(v) for k, v in extra_cfg.items()})
    inputs = []
    for name, value in fields.items():
        inputs.append(
            f'<input type="hidden" name="{htmlmod.escape(str(name), quote=True)}" '
            f'value="{htmlmod.escape(str(value), quote=True)}" />'
        )
    action = htmlmod.escape(app.login_url or "", quote=True)
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>SSO</title></head>"
        "<body onload='document.forms[0].submit()'>"
        f"<form method='{method}' action='{action}'>{''.join(inputs)}"
        "<noscript><button type='submit'>继续登录</button></noscript></form></body></html>"
    )
    record_sso_audit(
        app_id=app.id, app_name=app.name,
        user_id=getattr(user, "id", "") or "",
        username=getattr(user, "username", "") or creds["username"],
        event_type="login", login_type="form_based", result="success",
        ip=ip, user_agent=user_agent, detail={"loginUrl": app.login_url},
    )
    return {
        "type": "form_based",
        "loginUrl": app.login_url,
        "usernameField": user_field,
        "passwordField": pass_field,
        "method": method,
        "html": html,
        "needBinding": False,
    }


def _user_from_source_token(source: Application, token: str, target: Application):
    """用 A 系统密钥校验其签发的 JWT，得到跳转 B 所需的用户身份。"""
    if not source.secret_key:
        raise ApiError("来源应用未配置密钥", 400)
    try:
        payload = jwt.decode(
            token,
            source.secret_key,
            algorithms=[source.jwt_algorithm or "HS256"],
            options={"verify_aud": False},
            leeway=5,
        )
    except jwt.ExpiredSignatureError:
        raise ApiError("来源系统令牌已过期，请重新点击跳转", 401)
    except jwt.PyJWTError:
        raise ApiError("来源系统令牌无效", 401)

    iss = payload.get("iss")
    if iss and iss not in (source.code, source.id, "integration-platform"):
        raise ApiError("令牌签发者与来源应用不匹配", 401)
    aud = payload.get("aud")
    if aud and aud not in (target.code, target.id, source.code, "integration-platform"):
        raise ApiError("令牌 audience 与目标应用不匹配", 401)

    username = (payload.get("username") or payload.get("sub") or "").strip()
    if not username:
        raise ApiError("令牌缺少 username / sub", 400)

    from iam.models import User

    user = User.objects.filter(username=username).first()
    if user:
        if user.status != "active":
            raise ApiError("账号已被禁用或锁定", 403)
        return user
    return {
        "id": str(payload.get("sub") or username),
        "username": username,
        "email": payload.get("email") or "",
        "displayName": payload.get("displayName") or payload.get("display_name") or username,
        "roleId": payload.get("roleId") or payload.get("role_id") or "",
    }


def launch_cross_app_sso(
    *,
    source_ref: str,
    target_ref: str,
    token: str,
    redirect_path: str = "",
    ip: str = "",
    user_agent: str = "",
) -> dict:
    """A 已登录用户携带 A 签发的 token，由中台换发 B 的免登地址。"""
    if not token:
        raise ApiError("缺少来源系统 token", 400)
    source = get_app(source_ref)
    target = get_app(target_ref)
    if source.id == target.id:
        raise ApiError("来源应用与目标应用不能相同", 400)
    if source.status != "active":
        raise ApiError("来源应用未启用", 400)
    user = _user_from_source_token(source, token, target)
    result = initiate_sso_login(
        target.id, user, redirect_path=redirect_path, ip=ip, user_agent=user_agent,
    )
    result["sourceAppId"] = source.id
    result["sourceAppCode"] = source.code
    result["targetAppId"] = target.id
    result["targetAppCode"] = target.code
    return result


def _create_session(app: Application, user, login_type: str, ip: str, user_agent: str, expires_in: int) -> str:
    session_id = generate_id("sso-sess")
    now = timezone.now()
    SsoSession.objects.create(
        session_id=session_id,
        app_id=app.id,
        user_id=getattr(user, "id", "") or user.get("id"),
        username=getattr(user, "username", "") or user.get("username"),
        login_type=login_type,
        status="active",
        login_at=now,
        expires_at=now + timedelta(seconds=expires_in),
        ip=ip or "",
        user_agent=user_agent or "",
    )
    return session_id


def _jwt_login(app, user, redirect_path, ip, user_agent) -> dict:
    if not app.secret_key:
        raise ApiError("应用未配置密钥", 400)
    if not app.login_url:
        raise ApiError("应用未配置登录地址", 400)
    expires_in = app.jwt_expires_in or 30
    uid = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else "")
    username = getattr(user, "username", None) or (user.get("username") if isinstance(user, dict) else "")
    now = timezone.now()
    payload = {
        "sub": uid,
        "username": username,
        "email": getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else "") or "",
        "displayName": getattr(user, "display_name", None) or (user.get("displayName") if isinstance(user, dict) else username) or username,
        "roleId": getattr(user, "role_id", None) or (user.get("roleId") if isinstance(user, dict) else "") or "",
        "iss": "integration-platform",
        "aud": app.code,
        "jti": generate_id("jti"),
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    token = jwt.encode(payload, app.secret_key, algorithm=app.jwt_algorithm or "HS256")
    sep = "&" if "?" in app.login_url else "?"
    token_param = (app.settings or {}).get("tokenParamName") or "token"
    url = f"{app.login_url}{sep}{token_param}={quote(token)}"
    if redirect_path:
        url += f"&redirect={quote(redirect_path)}"
    session_id = _create_session(app, user, "jwt", ip, user_agent, expires_in)
    record_sso_audit(
        app_id=app.id, app_name=app.name, user_id=uid, username=username,
        event_type="login", login_type="jwt", result="success", ip=ip,
        user_agent=user_agent, session_id=session_id,
    )
    from monitor.metrics import observe_sso
    observe_sso(login_type="jwt", result="success")
    return {"type": "jwt", "url": url, "loginUrl": url, "token": token, "sessionId": session_id}


def _ticket_login(app, user, redirect_path, ip, user_agent) -> dict:
    if not app.login_url:
        raise ApiError("应用未配置登录地址", 400)
    ticket_value = generate_id("sst")
    expires = timezone.now() + timedelta(seconds=app.ticket_expires_in or 60)
    uid = getattr(user, "id", None) or user.get("id")
    username = getattr(user, "username", None) or user.get("username")
    SsoTicket.objects.create(
        ticket=ticket_value,
        app_id=app.id,
        user_id=uid,
        user_info={
            "id": uid, "username": username,
            "email": getattr(user, "email", None) or user.get("email"),
            "displayName": getattr(user, "display_name", None) or user.get("displayName"),
        },
        status="pending",
        expires_at=expires,
        ip=ip or "",
        user_agent=user_agent or "",
    )
    sep = "&" if "?" in app.login_url else "?"
    url = f"{app.login_url}{sep}ticket={quote(ticket_value)}"
    if redirect_path:
        url += f"&redirect={quote(redirect_path)}"
    session_id = _create_session(app, user, "ticket", ip, user_agent, app.ticket_expires_in or 60)
    record_sso_audit(
        app_id=app.id, app_name=app.name, user_id=uid, username=username,
        event_type="ticket_created", login_type="ticket", result="success",
        ip=ip, user_agent=user_agent, session_id=session_id,
    )
    return {"type": "ticket", "url": url, "loginUrl": url, "ticket": ticket_value, "sessionId": session_id}


def generate_oauth2_url(app: Application, state: str = "", redirect_uri: str = "") -> dict:
    from sso.oauth import start_authorization

    return start_authorization(app, redirect_uri=redirect_uri, extra_state=state)


def generate_saml_authn(app: Application, relay_state: str = "") -> dict:
    from sso.saml import start_authn

    return start_authn(app, relay_state=relay_state)


def saml_metadata_xml(app: Application) -> str:
    from sso.saml import saml_metadata_xml as _xml

    return _xml(app)


def validate_ticket(ticket: str, *, app_id: str = "", ip: str = "", user_agent: str = "") -> dict:
    row = SsoTicket.objects.filter(ticket=ticket).first()
    if not row:
        return {"valid": False, "error": "ticket 不存在"}
    if app_id and row.app_id != app_id:
        return {"valid": False, "error": "ticket 与应用不匹配"}
    if row.status != "pending":
        return {"valid": False, "error": f"ticket 状态无效: {row.status}"}
    if row.expires_at < timezone.now():
        row.status = "expired"
        row.save(update_fields=["status"])
        return {"valid": False, "error": "ticket 已过期"}
    row.status = "used"
    row.used_at = timezone.now()
    row.consumed_ip = ip or ""
    row.save()
    record_sso_audit(
        app_id=row.app_id, user_id=row.user_id, event_type="ticket_used",
        login_type="ticket", result="success", ip=ip, user_agent=user_agent,
    )
    return {"valid": True, "user": row.user_info, "appId": row.app_id}


def validate_sso_token(token: str) -> dict:
    apps = Application.objects.filter(status="active").exclude(secret_key="")
    for app in apps:
        try:
            payload = jwt.decode(token, app.secret_key, algorithms=[app.jwt_algorithm or "HS256"])
            return {"valid": True, "user": payload, "appId": app.id}
        except jwt.PyJWTError:
            continue
    return {"valid": False, "error": "无效 token"}


def list_user_apps(user_id: str, category: str | None = None, client_id: str = ""):
    qs = Application.objects.filter(status="active", visible=True).order_by("sort_order", "name")
    if client_id:
        # 客户账号的应用门户只展示本客户应用
        qs = qs.filter(client_id=client_id)
    if category:
        qs = qs.filter(category=category)
    return qs


def create_binding(user_id: str, app_id: str, *, external_user_id: str = "", credentials: dict | None = None) -> str:
    import json

    cred = ""
    username = ""
    if isinstance(credentials, dict):
        cred = encrypt(json.dumps(credentials, ensure_ascii=False, default=str))
        username = str(credentials.get("username") or credentials.get("user") or "")
    existing = UserAppBinding.objects.filter(user_id=user_id, app_id=app_id).first()
    if existing:
        if cred:
            existing.encrypted_credentials = cred
        if username:
            existing.external_username = username
        if external_user_id:
            existing.external_user_id = external_user_id
        existing.status = "active"
        existing.save()
        return existing.id
    obj = UserAppBinding.objects.create(
        user_id=user_id,
        app_id=app_id,
        external_user_id=external_user_id or "",
        external_username=username,
        encrypted_credentials=cred,
        status="active",
    )
    return obj.id
