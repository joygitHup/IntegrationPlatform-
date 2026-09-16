from rest_framework.response import Response
from rest_framework.views import APIView

from core.exceptions import ApiError
from core.permissions import IsAuthenticated
from core.query import q
from open_api.auth import ApiKeyAuthentication
from core.authentication import JWTAuthentication
from jobs.models import IntegrationJob
from core.tenancy import assert_object_owned, get_owned
from org_sync.models import Department
from org_sync.serializers import DepartmentSerializer, UserDepartmentSerializer
from org_sync.services import (
    create_department,
    get_department_tree,
    list_department_users,
    list_departments,
    sync_org_from_source,
    sync_user_departments,
)
from org_sync.templates import apply_template, get_template, list_templates


class DepartmentView(APIView):
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        dept_id = q(request, "id")
        if dept_id:
            dept = Department.objects.filter(id=dept_id).first()
            if not dept:
                raise ApiError("部门不存在", 404)
            # 部门通过任务挂客户：客户 JWT / API Key 都只能读本客户部门
            assert_object_owned(dept, request, not_found="部门不存在")
            return Response({"data": DepartmentSerializer(dept).data})
        job_id = q(request, "jobId", "job_id")
        users_of = q(request, "users")
        if not job_id:
            raise ApiError("缺少 jobId 参数", 400)
        get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        if users_of:
            users = list_department_users(
                job_id=job_id, dept_source_id=users_of,
                include_sub=q(request, "includeSub") == "true",
            )
            data = UserDepartmentSerializer(users, many=True).data
            return Response({"items": data, "total": len(data)})
        if q(request, "tree") == "true":
            return Response({"items": get_department_tree(job_id)})
        items = list_departments(job_id)
        data = DepartmentSerializer(items, many=True).data
        return Response({"items": data, "total": len(data), "page": 1, "pageSize": len(data)})

    def post(self, request):
        job_id = request.data.get("jobId")
        if not job_id:
            raise ApiError("缺少 jobId", 400)
        get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        dept = create_department(request.data)
        return Response({"data": DepartmentSerializer(dept).data}, status=201)


class OrgSyncView(APIView):
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        job_id = request.data.get("jobId")
        if not job_id:
            raise ApiError("缺少 jobId", 400)
        get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        mode = request.data.get("mode") or "incremental"
        result = sync_org_from_source(
            job_id=job_id,
            departments=request.data.get("departments") or [],
            mode=mode,
        )
        users = request.data.get("users") or []
        if users:
            result["userDepartments"] = sync_user_departments(
                job_id=job_id, users=users, mode="full" if mode == "full" else "incremental",
            )
        return Response(result)


class SyncTemplateView(APIView):
    authentication_classes = [ApiKeyAuthentication, JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        template_id = q(request, "id")
        if template_id:
            tpl = get_template(template_id)
            if not tpl:
                raise ApiError("模板不存在", 404)
            return Response({"data": tpl})
        items = list_templates(q(request, "category"))
        return Response({"items": items, "total": len(items)})

    def post(self, request):
        result = apply_template(request.data.get("templateId"), {
            "fieldMappings": request.data.get("fieldMappings"),
            "matchKeys": request.data.get("matchKeys"),
            "sensitiveFields": request.data.get("sensitiveFields"),
        })
        return Response({"data": result})
