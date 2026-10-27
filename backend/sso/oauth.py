"""OAuth2：平台作为客户端（授权码 + PKCE）以及作为授权服务器。"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import timedelta
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import jwt
from django.utils import timezone

from core.exceptions import ApiError
from core.ids import generate_id
from core.public_urls import canonical_issuer
from sso.models import Application, OAuthAuthorizationCode, OAuthState


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def callback_uri(app: Application) -> str:
    from core.public_urls import api_url

    return api_url(f"/sso/oauth2/{app.id}/callback")


def start_authorization(app: Application, *, user=None, redirect_uri: str = "", extra_state: str = "") -> dict:
    if not app.oauth_auth_url and not app.login_url:
        raise ApiError("未配置 OAuth 授权地址 oauthAuthUrl", 400)
    verifier = secrets.token_urlsafe(48)
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    state = extra_state or generate_id("state")
    nonce = generate_id("nonce")
    redirect = redirect_uri or app.callback_url or callback_uri(app)
    OAuthState.objects.create(
        state=state,
        app_id=app.id,
        user_id=getattr(user, "id", "") or "",
        redirect_uri=redirect,
        code_verifier=verifier,
        nonce=nonce,
        expires_at=timezone.now() + timedelta(minutes=10),
    )
    params = {
        "client_id": app.oauth_client_id or "",
        "response_type": "code",
        "state": state,
        "scope": app.oauth_scope or "openid profile email",
        "redirect_uri": redirect,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "nonce": nonce,
    }
    base = app.oauth_auth_url or app.login_url
    sep = "&" if "?" in base else "?"
    url = f"{base}{sep}{urlencode(params)}"
    return {"type": "oauth2", "url": url, "loginUrl": url, "state": state, "redirectUri": redirect}


def _http_form(url: str, data: dict, headers: dict | None = None) -> dict:
    body = urlencode(data).encode("utf-8")
    hdrs = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", **(headers or {})}
    req = Request(url, data=body, headers=hdrs, method="POST")
    with urlopen(req, timeout=20) as resp:
        text = resp.read().decode("utf-8", "ignore")
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        from urllib.parse import parse_qs

        parsed = {k: v[0] if v else "" for k, v in parse_qs(text).items()}
        return parsed


def _http_get_json(url: str, token: str) -> dict:
    req = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    with urlopen(req, timeout=20) as resp:
        text = resp.read().decode("utf-8", "ignore")
    return json.loads(text) if text else {}


def complete_authorization(app: Application, *, code: str, state: str, ip: str = "", user_agent: str = "") -> dict:
    from sso.engine import _create_session, record_sso_audit
    from monitor.metrics import observe_sso

    if not code:
        raise ApiError("缺少 authorization code", 400)
    row = OAuthState.objects.filter(state=state, app_id=app.id, consumed=False).first() if state else None
    if not row:
        raise ApiError("OAuth state 无效或已过期", 400)
    if row.expires_at < timezone.now():
        raise ApiError("OAuth state 已过期", 400)
    row.consumed = True
    row.save(update_fields=["consumed"])
    token_url = app.oauth_token_url
    if not token_url:
        raise ApiError("未配置 oauthTokenUrl", 400)
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": row.redirect_uri or callback_uri(app),
        "client_id": app.oauth_client_id or "",
        "client_secret": app.oauth_client_secret or "",
        "code_verifier": row.code_verifier,
    }
    token_data = _http_form(token_url, payload)
    access = token_data.get("access_token")
    if not access:
        raise ApiError(token_data.get("error_description") or token_data.get("error") or "换票失败", 400)
    profile = {}
    if app.oauth_userinfo_url:
        try:
            profile = _http_get_json(app.oauth_userinfo_url, access)
        except Exception as exc:
            logger.warning("OAuth userinfo 拉取失败 app=%s url=%s reason=%s，回退 id_token", app.code, app.oauth_userinfo_url, exc)
            profile = {}
    if not profile and token_data.get("id_token"):
        profile = _decode_id_token(app, token_data["id_token"])
    user = _map_user(app, profile)
    session_id = _create_session(app, user, "oauth2", ip, user_agent, app.jwt_expires_in or 3600)
    record_sso_audit(
        app_id=app.id, app_name=app.name,
        user_id=getattr(user, "id", None) or user.get("id"),
        username=getattr(user, "username", None) or user.get("username"),
        event_type="login", login_type="oauth2", result="success",
        ip=ip, user_agent=user_agent, session_id=session_id, detail={"sub": profile.get("sub")},
    )
    observe_sso(login_type="oauth2", result="success")
    sep = "&" if "?" in (app.login_url or "") else "?"
    url = ""
    if app.login_url:
        url = f"{app.login_url}{sep}access_token={access}"
        if token_data.get("id_token"):
            url += f"&id_token={token_data['id_token']}"
    return {
        "type": "oauth2",
        "ok": True,
        "url": url,
        "loginUrl": url,
        "sessionId": session_id,
        "user": {
            "id": getattr(user, "id", None) or user.get("id"),
            "username": getattr(user, "username", None) or user.get("username"),
            "email": getattr(user, "email", None) or user.get("email"),
            "displayName": getattr(user, "display_name", None) or user.get("displayName"),
        },
        "profile": {k: profile.get(k) for k in ("sub", "email", "name", "preferred_username") if k in profile},
        "tokenType": token_data.get("token_type") or "Bearer",
        "expiresIn": token_data.get("expires_in"),
    }


def _jwks_url(app: Application) -> str:
    import logging

    logger = logging.getLogger(__name__)
    extra = app.settings if isinstance(app.settings, dict) else {}
    explicit = extra.get("oauthJwksUrl") or extra.get("jwksUrl") or extra.get("jwks_url")
    if explicit:
        return str(explicit)
    auth = (app.oauth_auth_url or "").strip()
    if not auth:
        return ""
    issuer = auth.split("/authorize")[0].split("/oauth")[0].rstrip("/")
    well_known = issuer + "/.well-known/openid-configuration"
    try:
        req = Request(well_known, headers={"Accept": "application/json"})
        with urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8", "ignore") or "{}")
        return str(data.get("jwks_uri") or "")
    except Exception as exc:
        logger.warning("OAuth discovery 失败 app=%s issuer=%s reason=%s，回退到硬编码 jwks", app.code, issuer, exc)
        return issuer + "/.well-known/jwks.json"


def _decode_id_token(app: Application, token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise ApiError("id_token 无法解析", 400) from exc
    alg = str(header.get("alg") or "RS256")
    audience = app.oauth_client_id or None
    options = {"verify_aud": bool(audience), "verify_iss": False}
    try:
        if alg.startswith("HS"):
            secret = app.oauth_client_secret
            if not secret:
                raise ApiError("id_token 为 HMAC 但未配置 Client Secret", 400)
            return jwt.decode(token, secret, algorithms=[alg], audience=audience, options=options, leeway=30)
        jwks = _jwks_url(app)
        if not jwks:
            raise ApiError("无法获取 JWKS，无法校验 id_token 签名", 400)
        try:
            client = jwt.PyJWKClient(jwks, cache_keys=True)
        except TypeError:
            client = jwt.PyJWKClient(jwks)
        signing_key = client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=[alg],
            audience=audience,
            options=options,
            leeway=30,
        )
    except ApiError:
        raise
    except jwt.PyJWTError as exc:
        raise ApiError(f"id_token 签名校验失败: {exc}", 400) from exc


def _map_user(app: Application, profile: dict):
    from iam.models import User

    attr = (app.mapping_attribute or "").strip()
    mapping = app.account_mapping or "same_username"
    username = (
        (profile.get(attr) if attr else None)
        or profile.get("preferred_username")
        or profile.get("username")
        or (profile.get("email") or "").split("@")[0]
        or profile.get("sub")
        or ""
    )
    email = profile.get("email") or ""
    user = None
    if mapping == "same_email" and email:
        user = User.objects.filter(email=email).first()
    if user is None and username:
        user = User.objects.filter(username=username).first()
    if user:
        return user
    return {
        "id": str(profile.get("sub") or username or "oauth"),
        "username": username or str(profile.get("sub") or "oauth"),
        "email": email,
        "displayName": profile.get("name") or profile.get("displayName") or username,
    }


# ----- 平台作为授权服务器 -----
def issue_authorization_code(app: Application, user, *, redirect_uri: str, scope: str = "") -> str:
    allowed = (app.callback_url or "").strip()
    if allowed and redirect_uri and redirect_uri.split("?")[0] != allowed.split("?")[0]:
        raise ApiError("redirect_uri 与应用回调地址不一致", 400)
    code = secrets.token_urlsafe(32)
    OAuthAuthorizationCode.objects.create(
        code=code,
        app_id=app.id,
        user_id=getattr(user, "id", "") or user.get("id"),
        redirect_uri=redirect_uri or allowed,
        scope=scope or app.oauth_scope or "openid profile",
        expires_at=timezone.now() + timedelta(minutes=5),
    )
    return code


def exchange_code(*, client_id: str, client_secret: str, code: str, redirect_uri: str = "") -> dict:
    app = (
        Application.objects.filter(oauth_client_id=client_id).first()
        or Application.objects.filter(code=client_id).first()
        or Application.objects.filter(id=client_id).first()
    )
    if not app:
        raise ApiError("invalid_client", 401)
    secret = app.oauth_client_secret or app.secret_key
    if not secret or secret != client_secret:
        raise ApiError("invalid_client", 401)
    row = OAuthAuthorizationCode.objects.filter(code=code, app_id=app.id, consumed=False).first()
    if not row or row.expires_at < timezone.now():
        raise ApiError("invalid_grant", 400)
    if redirect_uri and row.redirect_uri and redirect_uri != row.redirect_uri:
        raise ApiError("invalid_grant", 400)
    row.consumed = True
    row.save(update_fields=["consumed"])
    from iam.models import User

    user = User.objects.filter(id=row.user_id).first()
    now = timezone.now()
    payload = {
        "sub": row.user_id,
        "username": getattr(user, "username", "") if user else "",
        "email": getattr(user, "email", "") if user else "",
        "displayName": getattr(user, "display_name", "") if user else "",
        "iss": canonical_issuer(),
        "aud": app.code,
        "scope": row.scope,
        "iat": now,
        "exp": now + timedelta(seconds=app.jwt_expires_in or 3600),
    }
    token = jwt.encode(payload, secret, algorithm=app.jwt_algorithm or "HS256")
    refresh = _issue_refresh_token(app, user, row.scope, secret)
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": app.jwt_expires_in or 3600,
        "refresh_token": refresh,
        "scope": row.scope,
    }


def _issue_refresh_token(app: Application, user, scope: str, secret: str) -> str:
    """签发无状态 refresh token JWT（7d TTL，含 jti 供轮换/吊销追踪）。

    用 app 密钥签名，与 access token 同密钥不同 payload（type=refresh）。
    轮换：使用时把旧 jti 写入 RevokedToken，签发新 refresh token。
    """
    import uuid
    from datetime import timedelta

    # refresh token TTL：默认 7d，可通过 app.settings.refreshExpiresIn 覆盖
    extra = app.settings if isinstance(app.settings, dict) else {}
    refresh_ttl = int(extra.get("refreshExpiresIn") or extra.get("refresh_expires_in") or 7 * 24 * 3600)

    now = timezone.now()
    user_id = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else "")
    username = getattr(user, "username", None) or (user.get("username") if isinstance(user, dict) else "")
    payload = {
        "sub": user_id,
        "username": username,
        "iss": canonical_issuer(),
        "aud": app.code,
        "scope": scope,
        "type": "refresh",
        "iat": now,
        "exp": now + timedelta(seconds=refresh_ttl),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, secret, algorithm=app.jwt_algorithm or "HS256")


def exchange_refresh_token(*, client_id: str, client_secret: str, refresh_token: str) -> dict:
    """refresh_token grant：校验 + 轮换 + 签发新 access/refresh token。

    RFC 6749 §6：B 端用 refresh_token 换新 access_token；最佳实践是
    轮换（旧 refresh 立即作废，签发新 refresh），防止 refresh 被盗用。
    """
    app = (
        Application.objects.filter(oauth_client_id=client_id).first()
        or Application.objects.filter(code=client_id).first()
        or Application.objects.filter(id=client_id).first()
    )
    if not app:
        raise ApiError("invalid_client", 401)
    secret = app.oauth_client_secret or app.secret_key
    if not secret or secret != client_secret:
        raise ApiError("invalid_client", 401)
    try:
        payload = jwt.decode(
            refresh_token, secret,
            algorithms=[app.jwt_algorithm or "HS256"],
            audience=app.code,
            options={"verify_aud": True, "verify_iss": False},
            leeway=30,
        )
    except jwt.PyJWTError as exc:
        raise ApiError("invalid_grant: refresh_token 无效或已过期", 400) from exc
    if payload.get("type") != "refresh":
        raise ApiError("invalid_grant: token 类型错误", 400)

    from iam.models import RevokedToken
    from django.utils import timezone as _tz
    from datetime import timedelta

    jti = payload.get("jti") or ""
    if jti and RevokedToken.objects.filter(jti=jti).exists():
        # 旧 refresh 已被吊销/轮换过：拒绝，防止重放
        raise ApiError("invalid_grant: refresh_token 已被使用", 400)

    # 轮换：把旧 jti 加入黑名单（按 refresh token 自身的 exp 设黑名单过期时间）
    exp_ts = payload.get("exp")
    revoked_expires = _tz.now() + timedelta(seconds=7 * 24 * 3600)
    if exp_ts:
        try:
            from datetime import datetime
            revoked_expires = datetime.fromtimestamp(int(exp_ts), tz=_tz.utc if hasattr(_tz, "utc") else None)
        except (TypeError, ValueError, OSError):
            pass
    RevokedToken.objects.get_or_create(
        jti=jti,
        defaults={
            "id": generate_id("rev"),
            "user_id": payload.get("sub", ""),
            "expires_at": revoked_expires,
        },
    )

    from iam.models import User
    user = User.objects.filter(id=payload.get("sub")).first()
    if not user:
        raise ApiError("invalid_grant: 用户不存在", 400)
    if user.status != "active":
        raise ApiError("invalid_grant: 账号已被禁用", 400)

    scope = payload.get("scope") or app.oauth_scope or "openid profile"
    now = timezone.now()
    access_payload = {
        "sub": user.id,
        "username": user.username,
        "email": user.email or "",
        "displayName": user.display_name or "",
        "iss": canonical_issuer(),
        "aud": app.code,
        "scope": scope,
        "iat": now,
        "exp": now + timedelta(seconds=app.jwt_expires_in or 3600),
    }
    access = jwt.encode(access_payload, secret, algorithm=app.jwt_algorithm or "HS256")
    new_refresh = _issue_refresh_token(app, user, scope, secret)
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": app.jwt_expires_in or 3600,
        "refresh_token": new_refresh,
        "scope": scope,
    }


def userinfo_from_token(token: str) -> dict:
    apps = Application.objects.filter(status="active")
    last_err = "invalid_token"
    for app in apps:
        secret = app.oauth_client_secret or app.secret_key
        if not secret:
            continue
        try:
            payload = jwt.decode(token, secret, algorithms=[app.jwt_algorithm or "HS256"], options={"verify_aud": False})
            return {
                "sub": payload.get("sub"),
                "username": payload.get("username"),
                "preferred_username": payload.get("username"),
                "email": payload.get("email"),
                "name": payload.get("displayName") or payload.get("username"),
            }
        except jwt.PyJWTError as exc:
            last_err = str(exc)
    raise ApiError(last_err, 401)
