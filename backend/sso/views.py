"""应用管理、绑定、SSO 登录 / 会话 / 审计。"""
from django.db.models import Q
from django.http import HttpResponse
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import audit_from_request
from core.env import query_environment
from core.exceptions import ApiError
from core.permissions import HasPermission, IsAuthenticated, has_permission
from core.query import q, q_int
from core.tenancy import assert_object_owned, client_app_ids, get_owned, principal_client_id, scope_qs
from iam.models import User
from sso.engine import (
    create_binding,
    generate_oauth2_url,
    initiate_sso_login,
    launch_cross_app_sso,
    list_user_apps,
    saml_metadata_xml,
    validate_sso_token,
    validate_ticket,
)
from sso.models import Application, SsoAuditLog, SsoSession, UserAppBinding
from sso.serializers import (
    ApplicationSerializer,
    BindingSerializer,
    CreateAppSerializer,
    SessionSerializer,
    UpdateAppSerializer,
)
from open_api.partner import apply_create_context, request_workspace_id
from sso.services import create_app, list_apps, update_app


def _assert_same_client_user(request, user_id: str) -> None:
    """客户主体操作他人数据时，目标用户必须属于同一客户（不可见统一 404）。"""
    cid = principal_client_id(request)
    if not cid or not user_id:
        return
    u = User.objects.filter(id=user_id).first()
    if u is None or (u.client_id or "") != cid:
        raise ApiError("用户不存在", 404, code="NOT_FOUND")


class AppListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        visible_only = q(request, "visibleOnly") == "true"
        qs = list_apps(
            keyword=q(request, "keyword"),
            category=q(request, "category"),
            status=q(request, "status"),
            login_type=q(request, "loginType", "login_type"),
            visible=True if visible_only else None,
            client_id=principal_client_id(request),
            environment=query_environment(request),
            workspace_id=request_workspace_id(request),
        )
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": ApplicationSerializer(items, many=True).data,
            "total": total, "page": page, "pageSize": page_size,
        })

    def post(self, request):
        if not has_permission(request.auth_ctx, "app:write"):
            raise ApiError("权限不足", 403)
        ser = CreateAppSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        app, secret = create_app(apply_create_context(request, ser.validated_data), created_by=request.auth_ctx.user_id)
        audit_from_request(
            request, action="CREATE", resource_type="APP",
            resource_id=app.id, resource_name=app.name,
            detail={"code": app.code, "loginType": app.login_type},
        )
        data = ApplicationSerializer(app).data
        data["secretKey"] = secret
        return Response(data)


class AppDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, id: str):
        app = get_owned(Application, id, request, not_found="应用不存在")
        return Response(ApplicationSerializer(app).data)

    def put(self, request, id: str):
        if not has_permission(request.auth_ctx, "app:write"):
            raise ApiError("权限不足", 403)
        get_owned(Application, id, request, not_found="应用不存在")
        ser = UpdateAppSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        app = update_app(id, ser.validated_data)
        if not app:
            raise ApiError("应用不存在", 404)
        audit_from_request(request, action="UPDATE", resource_type="APP", resource_id=id, resource_name=app.name)
        return Response(ApplicationSerializer(app).data)

    def delete(self, request, id: str):
        if not has_permission(request.auth_ctx, "app:delete"):
            raise ApiError("权限不足", 403)
        app = get_owned(Application, id, request, not_found="应用不存在")
        app.delete()
        audit_from_request(request, action="DELETE", resource_type="APP", resource_id=id, resource_name=app.name)
        return Response({"success": True})


class MyAppsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        apps = list_user_apps(
            request.auth_ctx.user_id,
            q(request, "category"),
            client_id=principal_client_id(request),
        )
        keyword = q(request, "keyword")
        items = ApplicationSerializer(apps, many=True).data
        if keyword:
            kw = keyword.lower()
            items = [a for a in items if kw in (a.get("name") or "").lower()]
        return Response({"items": items, "total": len(items)})


class BindingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user_id = q(request, "userId", "user_id") or request.auth_ctx.user_id
        if user_id != request.auth_ctx.user_id and not has_permission(request.auth_ctx, "app:write"):
            raise ApiError("权限不足", 403)
        _assert_same_client_user(request, user_id)
        qs = UserAppBinding.objects.filter(user_id=user_id)
        cid = principal_client_id(request)
        if cid:
            # 只允许看到本客户应用的绑定
            qs = qs.filter(app_id__in=client_app_ids(cid))
        app_id = q(request, "appId", "app_id")
        if app_id:
            qs = qs.filter(app_id=app_id)
        items = BindingSerializer(qs, many=True).data
        return Response({"items": items, "total": len(items)})

    def post(self, request):
        target = request.data.get("userId") or request.data.get("user_id") or request.auth_ctx.user_id
        if target != request.auth_ctx.user_id and not has_permission(request.auth_ctx, "app:write"):
            raise ApiError("权限不足", 403)
        _assert_same_client_user(request, target)
        app_id = request.data.get("appId") or request.data.get("app_id")
        # 只能给本客户应用建绑定
        get_owned(Application, app_id, request, not_found="应用不存在")
        binding_id = create_binding(
            target,
            app_id,
            external_user_id=request.data.get("externalUserId") or "",
            credentials=request.data.get("credentials"),
        )
        audit_from_request(request, action="CREATE", resource_type="APP_BINDING", resource_id=binding_id)
        return Response({"id": binding_id})

    def put(self, request):
        binding_id = q(request, "id")
        obj = UserAppBinding.objects.filter(id=binding_id).first()
        if not obj:
            raise ApiError("绑定不存在", 404)
        is_self = obj.user_id == request.auth_ctx.user_id
        if not is_self and not has_permission(request.auth_ctx, "app:write"):
            raise ApiError("权限不足", 403)
        # 绑定到的应用必须归属当前主体客户
        linked_app = Application.objects.filter(id=obj.app_id).first()
        if linked_app is not None:
            assert_object_owned(linked_app, request, not_found="绑定不存在")
        if request.data.get("externalUserId") is not None:
            obj.external_user_id = request.data.get("externalUserId")
        if request.data.get("externalUsername") is not None:
            obj.external_username = request.data.get("externalUsername")
        if request.data.get("credentials") is not None:
            import json

            from core.encryption import encrypt

            creds = request.data.get("credentials")
            obj.encrypted_credentials = encrypt(json.dumps(creds, ensure_ascii=False, default=str)) if creds else ""
            if isinstance(creds, dict) and (creds.get("username") or creds.get("user")):
                obj.external_username = str(creds.get("username") or creds.get("user"))
        obj.save()
        return Response(BindingSerializer(obj).data)

    def delete(self, request):
        if not has_permission(request.auth_ctx, "app:write"):
            raise ApiError("权限不足", 403)
        obj = UserAppBinding.objects.filter(id=q(request, "id")).first()
        if not obj:
            raise ApiError("绑定不存在", 404)
        linked_app = Application.objects.filter(id=obj.app_id).first()
        if linked_app is not None:
            assert_object_owned(linked_app, request, not_found="绑定不存在")
        obj.delete()
        return Response({"success": True})


class SsoLoginView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        app_id = request.data.get("appId")
        if not app_id:
            raise ApiError("缺少 appId", 400)
        get_owned(Application, app_id, request, not_found="应用不存在")
        result = initiate_sso_login(
            app_id, request.auth_ctx.user or request.user,
            redirect_path=request.data.get("redirectUrl") or "",
            ip=request.auth_ctx.ip,
            user_agent=request.auth_ctx.user_agent,
        )
        return Response(result)

    def get(self, request):
        app_id = q(request, "appId")
        if not app_id:
            raise ApiError("缺少 appId", 400)
        get_owned(Application, app_id, request, not_found="应用不存在")
        result = initiate_sso_login(
            app_id, request.auth_ctx.user or request.user,
            redirect_path=q(request, "redirect") or "",
            ip=request.auth_ctx.ip,
            user_agent=request.auth_ctx.user_agent,
        )
        url = result.get("url") or result.get("loginUrl")
        if url:
            from django.shortcuts import redirect
            return redirect(url)
        return Response(result)


class SsoLaunchView(APIView):
    """A → 中台 → B：入口点击免登跳转，不要求先登录中台控制台。"""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        result = self._launch(request.data, request)
        return Response(result)

    def get(self, request):
        data = {
            "from": q(request, "from", "sourceApp", "sourceAppId", "source_app_id"),
            "to": q(request, "to", "targetApp", "targetAppId", "target_app_id"),
            "token": q(request, "token"),
            "redirectUrl": q(request, "redirect", "redirectUrl"),
        }
        result = self._launch(data, request)
        url = result.get("url") or result.get("loginUrl")
        if url:
            from django.shortcuts import redirect

            return redirect(url)
        return Response(result)

    def _launch(self, data, request):
        ip = (
            request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("REMOTE_ADDR")
            or ""
        )
        ua = request.META.get("HTTP_USER_AGENT", "")
        source = data.get("from") or data.get("sourceApp") or data.get("sourceAppId") or data.get("source_app_id")
        target = data.get("to") or data.get("targetApp") or data.get("targetAppId") or data.get("target_app_id")
        token = data.get("token")
        if not source or not target:
            raise ApiError("缺少 from / to（来源应用、目标应用的编码或 ID）", 400)
        return launch_cross_app_sso(
            source_ref=str(source),
            target_ref=str(target),
            token=str(token or ""),
            redirect_path=data.get("redirectUrl") or data.get("redirect") or "",
            ip=ip,
            user_agent=ua,
        )


class SsoValidateView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        return Response(self._validate(request.data, request))

    def get(self, request):
        return Response(self._validate(request.query_params, request))

    def _validate(self, data, request):
        ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
        ua = request.META.get("HTTP_USER_AGENT", "")
        ticket = data.get("ticket")
        token = data.get("token")
        app_id = data.get("appId") or data.get("app_id")
        if ticket:
            return validate_ticket(ticket, app_id=app_id or "", ip=ip, user_agent=ua)
        if token:
            return validate_sso_token(token)
        raise ApiError("缺少 ticket 或 token", 400)


class SsoSessionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        user_id = q(request, "userId", "user_id")
        can_manage = has_permission(request.auth_ctx, "sso:manage")
        if user_id:
            if user_id != request.auth_ctx.user_id and not can_manage:
                raise ApiError("权限不足", 403)
            _assert_same_client_user(request, user_id)
            qs = SsoSession.objects.filter(user_id=user_id)
        elif can_manage:
            qs = SsoSession.objects.all()
        else:
            qs = SsoSession.objects.filter(user_id=request.auth_ctx.user_id)
        # 客户主体统一收敛到本客户应用的会话
        qs = scope_qs(qs, request)
        status = q(request, "status")
        if status:
            qs = qs.filter(status=status)
        qs = qs.order_by("-login_at")
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": SessionSerializer(items, many=True).data,
            "total": total, "page": page, "pageSize": page_size,
        })

    def delete(self, request):
        from django.utils import timezone

        if q(request, "all") == "true":
            qs = SsoSession.objects.filter(user_id=request.auth_ctx.user_id, status="active")
            count = qs.count()
            qs.update(status="revoked", logout_at=timezone.now(), logout_type="user_initiated")
            return Response({"success": True, "revokedCount": count})
        session_id = q(request, "sessionId")
        if not session_id:
            raise ApiError("缺少 sessionId", 400)
        session = SsoSession.objects.filter(session_id=session_id).first()
        if not session:
            raise ApiError("会话不存在", 404)
        # 只能吊销自己的会话；管理员可吊销本客户应用的会话
        if session.user_id != request.auth_ctx.user_id:
            if not has_permission(request.auth_ctx, "sso:manage"):
                raise ApiError("权限不足", 403)
            assert_object_owned(session, request, not_found="会话不存在")
        session.status = "revoked"
        session.logout_at = timezone.now()
        session.logout_type = "user_initiated"
        session.save(update_fields=["status", "logout_at", "logout_type"])
        return Response({"success": True, "revoked": True})


class SsoLogView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ctx = request.auth_ctx
        if not (
            has_permission(ctx, "sso:audit")
            or has_permission(ctx, "app:read")
            or has_permission(ctx, "audit:read")
        ):
            raise ApiError("权限不足", 403)
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        # 客户账号只能看本客户应用的 SSO 审计
        qs = scope_qs(SsoAuditLog.objects.all(), request).order_by("-created_at")
        if q(request, "appId", "app_id"):
            qs = qs.filter(app_id=q(request, "appId", "app_id"))
        if q(request, "userId", "user_id"):
            qs = qs.filter(user_id=q(request, "userId", "user_id"))
        if q(request, "eventType", "event_type"):
            qs = qs.filter(event_type=q(request, "eventType", "event_type"))
        if q(request, "result"):
            qs = qs.filter(result=q(request, "result"))
        keyword = q(request, "keyword")
        if keyword:
            qs = qs.filter(
                Q(username__icontains=keyword)
                | Q(app_name__icontains=keyword)
                | Q(ip__icontains=keyword)
                | Q(failure_reason__icontains=keyword)
                | Q(user_id__icontains=keyword)
            )
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        data = []
        for log in items:
            data.append({
                "id": log.id,
                "appId": log.app_id,
                "appName": log.app_name,
                "userId": log.user_id,
                "username": log.username,
                "eventType": log.event_type,
                "loginType": log.login_type,
                "result": log.result,
                "failureReason": log.failure_reason,
                "detail": log.detail,
                "details": log.detail,
                "ip": log.ip,
                "userAgent": log.user_agent,
                "sessionId": log.session_id,
                "createdAt": log.created_at.isoformat() if log.created_at else None,
            })
        return Response({
            "items": data,
            "total": total, "page": page, "pageSize": page_size,
        })


class SamlMetadataView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, appId: str):
        app = Application.objects.filter(id=appId).first()
        if not app:
            raise ApiError("应用不存在", 404)
        return HttpResponse(saml_metadata_xml(app), content_type="application/xml")


class SamlAcsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [FormParser, MultiPartParser, JSONParser]

    def post(self, request, appId: str):
        from sso.saml import consume_response

        app = Application.objects.filter(id=appId).first() or Application.objects.filter(code=appId).first()
        if not app:
            raise ApiError("应用不存在", 404)
        data = request.POST if request.POST else request.data
        xml = data.get("SAMLResponse") or data.get("samlResponse")
        relay = data.get("RelayState") or data.get("relayState") or ""
        ip = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip() or request.META.get("REMOTE_ADDR") or ""
        result = consume_response(app, xml, relay_state=relay, ip=ip, user_agent=request.META.get("HTTP_USER_AGENT", ""))
        url = result.get("url")
        if url and request.content_type and "xml" not in (request.content_type or "") and request.POST:
            from django.shortcuts import redirect

            return redirect(url)
        return Response(result)


class OAuthAuthorizeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, appId: str):
        app = Application.objects.filter(id=appId).first() or Application.objects.filter(code=appId).first()
        if not app:
            raise ApiError("应用不存在", 404)
        assert_object_owned(app, request, not_found="应用不存在")
        result = generate_oauth2_url(app, redirect_uri=q(request, "redirect_uri") or "")
        url = result.get("url")
        if url and q(request, "redirect") == "1":
            from django.shortcuts import redirect

            return redirect(url)
        return Response(result)


class OAuthCallbackView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, appId: str):
        from sso.oauth import complete_authorization

        app = Application.objects.filter(id=appId).first() or Application.objects.filter(code=appId).first()
        if not app:
            raise ApiError("应用不存在", 404)
        err = q(request, "error")
        if err:
            raise ApiError(q(request, "error_description") or err, 400)
        ip = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip() or request.META.get("REMOTE_ADDR") or ""
        result = complete_authorization(
            app,
            code=q(request, "code") or "",
            state=q(request, "state") or "",
            ip=ip,
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
        )
        url = result.get("url")
        if url:
            from django.shortcuts import redirect

            return redirect(url)
        return Response(result)


class OAuthServerAuthorizeView(APIView):
    """平台作为授权服务器：登录用户授权第三方应用。"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from sso.oauth import issue_authorization_code
        from urllib.parse import urlencode
        from django.shortcuts import redirect

        client_id = q(request, "client_id")
        redirect_uri = q(request, "redirect_uri") or ""
        state = q(request, "state") or ""
        scope = q(request, "scope") or ""
        if q(request, "response_type") not in ("code", "", None):
            raise ApiError("仅支持 response_type=code", 400)
        app = (
            Application.objects.filter(oauth_client_id=client_id).first()
            or Application.objects.filter(code=client_id).first()
            or Application.objects.filter(id=client_id).first()
        )
        if not app:
            raise ApiError("unknown client_id", 400)
        assert_object_owned(app, request, not_found="应用不存在")
        code = issue_authorization_code(app, request.user, redirect_uri=redirect_uri, scope=scope)
        target = redirect_uri or app.callback_url
        if not target:
            return Response({"code": code, "state": state})
        sep = "&" if "?" in target else "?"
        qs = urlencode({"code": code, "state": state})
        return redirect(f"{target}{sep}{qs}")


class OAuthServerTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [FormParser, JSONParser, MultiPartParser]

    def post(self, request):
        from sso.oauth import exchange_code

        data = request.POST if request.POST else request.data
        grant = data.get("grant_type") or "authorization_code"
        if grant != "authorization_code":
            raise ApiError("unsupported_grant_type", 400)
        result = exchange_code(
            client_id=data.get("client_id") or "",
            client_secret=data.get("client_secret") or "",
            code=data.get("code") or "",
            redirect_uri=data.get("redirect_uri") or "",
        )
        return Response(result)


class OAuthServerUserinfoView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        from sso.oauth import userinfo_from_token

        auth = request.META.get("HTTP_AUTHORIZATION") or ""
        token = auth[7:].strip() if auth.startswith("Bearer ") else q(request, "access_token") or ""
        if not token:
            raise ApiError("invalid_token", 401)
        return Response(userinfo_from_token(token))
