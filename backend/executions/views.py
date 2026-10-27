"""执行历史、死信队列、字段审计、版本快照。"""
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import audit_from_request
from core.exceptions import ApiError
from core.permissions import HasPermission, IsAuthenticated
from core.query import q, q_int
from core.tenancy import get_owned, principal_client_id, scope_qs
from executions.models import DataVersionSnapshot, DeadLetterMessage, FieldChangeAudit, JobExecution
from executions.serializers import FieldAuditSerializer
from executions.services import (
    bulk_resolve_dead_letters,
    bulk_select_dead_letters,
    dead_letter_summary,
    execute_snapshot_rollback,
    execution_summary,
    ignore_dead_letter,
    jobs_map,
    list_dead_letters,
    list_executions,
    peek_dead_letter_target,
    reprocess_dead_letter,
    resolve_dead_letter,
    serialize_dead_letter,
    serialize_execution,
)
from jobs.models import IntegrationJob
from open_api.partner import request_workspace_id


class ExecutionListView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "execution:read"

    def get(self, request):
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = scope_qs(
            list_executions(
                job_id=q(request, "jobId", "job_id"),
                status=q(request, "status"),
                trigger_type=q(request, "triggerType", "trigger_type"),
                keyword=q(request, "keyword"),
                workspace_id=request_workspace_id(request),
            ),
            request,
        )
        total = qs.count()
        items = list(qs[(page - 1) * page_size : page * page_size])
        jobs = jobs_map(e.job_id for e in items)
        return Response({
            "items": [serialize_execution(e, jobs.get(e.job_id)) for e in items],
            "total": total,
            "page": page,
            "pageSize": page_size,
            "summary": execution_summary(qs),
        })


class ExecutionDetailView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "execution:read"

    def get(self, request, id: str):
        exe = get_owned(JobExecution, id, request, not_found="执行记录不存在")
        return Response(serialize_execution(exe))


class DeadLetterView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_read_permission = "dlq:read"
    required_write_permission = "dlq:reprocess"

    def get(self, request):
        dl_id = q(request, "id")
        if dl_id:
            item = get_owned(DeadLetterMessage, dl_id, request, not_found="死信消息不存在")
            jobs = jobs_map([item.job_id])
            data = serialize_dead_letter(item, jobs.get(item.job_id))
            if q(request, "includeTarget") == "true":
                data["target"] = peek_dead_letter_target(item)
            return Response(data)
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = scope_qs(
            list_dead_letters(
                job_id=q(request, "jobId", "job_id"),
                execution_id=q(request, "executionId", "execution_id"),
                status=q(request, "status"),
                error_type=q(request, "errorType", "error_type"),
                keyword=q(request, "keyword"),
                workspace_id=request_workspace_id(request),
            ),
            request,
        )
        total = qs.count()
        items = list(qs[(page - 1) * page_size : page * page_size])
        jobs = jobs_map(d.job_id for d in items)
        return Response({
            "items": [serialize_dead_letter(d, jobs.get(d.job_id)) for d in items],
            "total": total,
            "page": page,
            "pageSize": page_size,
            "summary": dead_letter_summary(qs),
        })

    def post(self, request):
        action = request.data.get("action")
        if action not in ("reprocess", "ignore", "resolve"):
            raise ApiError("action 只能是 reprocess、ignore 或 resolve", 400)

        # 两种选 id 方式：显式 ids 数组 或 按 filter 筛选
        ids: list[str] = list(request.data.get("ids") or [])
        if not ids:
            filt = request.data.get("filter") or {}
            if isinstance(filt, dict):
                ids = bulk_select_dead_letters(
                    job_id=filt.get("jobId") or filt.get("job_id"),
                    status=filt.get("status"),
                    error_type=filt.get("errorType") or filt.get("error_type"),
                    workspace_id=request_workspace_id(request),
                    client_id=principal_client_id(request),
                )
        if not ids:
            raise ApiError("缺少 ids 或 filter 参数", 400)

        # 逐条归属校验：他客死信跳过不处理，避免跨客裁决
        owned_ids: list[str] = []
        for item_id in ids:
            try:
                get_owned(DeadLetterMessage, item_id, request, not_found="死信消息不存在")
                owned_ids.append(item_id)
            except Exception:
                pass
        if not owned_ids:
            raise ApiError("无可用的死信条目（全部不属于当前客户）", 404)

        payloads = request.data.get("payloads")
        default_payload = request.data.get("payload")
        winner = request.data.get("winner") or "source"
        execute = request.data.get("execute") is not False
        results = bulk_resolve_dead_letters(
            ids=owned_ids,
            action=action,
            processed_by=request.auth_ctx.user_id,
            payloads=payloads if isinstance(payloads, dict) else None,
            default_payload=default_payload if isinstance(default_payload, dict) else None,
            winner=winner,
            execute=execute,
        )
        audit_from_request(
            request, action="UPDATE", resource_type="JOB",
            resource_id=",".join(owned_ids), detail={"action": action, "count": len(owned_ids)},
        )
        return Response({"results": results, "total": len(owned_ids)})


class FieldAuditView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        audit_id = q(request, "id")
        if audit_id:
            item = get_owned(FieldChangeAudit, audit_id, request, not_found="记录不存在")
            return Response({"data": FieldAuditSerializer(item).data})
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = scope_qs(FieldChangeAudit.objects.all(), request).order_by("-created_at")
        if q(request, "jobId", "job_id"):
            qs = qs.filter(job_id=q(request, "jobId", "job_id"))
        if q(request, "executionId", "execution_id"):
            qs = qs.filter(execution_id=q(request, "executionId", "execution_id"))
        if q(request, "recordKey", "record_key"):
            qs = qs.filter(record_key=q(request, "recordKey", "record_key"))
        if q(request, "operation"):
            qs = qs.filter(operation=q(request, "operation"))
        ws = request_workspace_id(request)
        if ws:
            from open_api.tenancy import workspace_job_ids

            qs = qs.filter(job_id__in=workspace_job_ids(ws))
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": FieldAuditSerializer(items, many=True).data,
            "total": total, "page": page, "pageSize": page_size,
        })


class VersionSnapshotView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        snapshot_id = q(request, "id")
        if snapshot_id:
            item = get_owned(DataVersionSnapshot, snapshot_id, request, not_found="快照不存在")
            return Response({"data": {
                "id": item.id, "jobId": item.job_id, "executionId": item.execution_id,
                "version": item.version, "snapshotType": item.snapshot_type,
                "recordCount": item.record_count, "snapshotData": item.snapshot_data,
                "createdAt": item.created_at,
            }})
        job_id = q(request, "jobId", "job_id")
        if not job_id:
            raise ApiError("缺少 jobId 参数", 400)
        get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        qs = scope_qs(DataVersionSnapshot.objects.filter(job_id=job_id), request).order_by("-created_at")
        if q(request, "snapshotType", "snapshot_type"):
            qs = qs.filter(snapshot_type=q(request, "snapshotType", "snapshot_type"))
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        data = [{
            "id": s.id, "jobId": s.job_id, "executionId": s.execution_id,
            "version": s.version, "snapshotType": s.snapshot_type,
            "recordCount": s.record_count, "createdAt": s.created_at,
        } for s in items]
        return Response({"items": data, "total": total, "page": page, "pageSize": page_size})

    def post(self, request):
        job_id = request.data.get("jobId") or request.data.get("job_id")
        if not job_id:
            raise ApiError("缺少 jobId", 400)
        target_version = request.data.get("targetVersion") or 1
        snapshot_type = request.data.get("snapshotType") or "before"
        snapshot_id = request.data.get("snapshotId") or request.data.get("id")
        snap = None
        get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        if snapshot_id:
            snap = DataVersionSnapshot.objects.filter(id=snapshot_id, job_id=job_id).first()
            if snap:
                get_owned(DataVersionSnapshot, snap.id, request, not_found="快照不存在")
        else:
            snap = DataVersionSnapshot.objects.filter(
                job_id=job_id, version=target_version, snapshot_type=snapshot_type
            ).first()
        plan = {
            "jobId": job_id,
            "snapshotId": snap.id if snap else None,
            "targetVersion": snap.version if snap else target_version,
            "snapshotType": snap.snapshot_type if snap else snapshot_type,
            "recordCount": snap.record_count if snap else 0,
            "operations": [{"op": "restore", "count": snap.record_count}] if snap else [],
        }
        if not request.data.get("execute"):
            return Response({"plan": plan})
        if not snap:
            raise ApiError("快照不存在", 404)
        job = get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        actor = getattr(getattr(request, "auth_ctx", None), "user_id", "") or ""
        result = execute_snapshot_rollback(job, snap, triggered_by=actor)
        audit_from_request(
            request, action="UPDATE", resource_type="JOB",
            resource_id=job.id, resource_name=job.name,
            detail={"kind": "snapshotRollback", "snapshotId": snap.id, "written": result.get("written")},
        )
        return Response({"plan": plan, "result": result})

    def delete(self, request):
        snapshot_id = q(request, "id")
        if not snapshot_id:
            raise ApiError("缺少快照 ID", 400)
        snap = get_owned(DataVersionSnapshot, snapshot_id, request, not_found="快照不存在")
        snap.delete()
        return Response({"success": True})


class WorkflowRunView(APIView):
    permission_classes = [IsAuthenticated, HasPermission]
    required_permission = "execution:read"

    def get(self, request):
        from executions.models import WorkflowRun

        run_id = q(request, "id")
        if run_id:
            run = get_owned(WorkflowRun, run_id, request, not_found="编排运行不存在")
            steps = list(
                scope_qs(JobExecution.objects.filter(workflow_run_id=run.id), request).order_by("created_at")
            )
            from executions.dag import normalize_steps

            job = IntegrationJob.objects.filter(id=run.job_id).first()
            return Response({
                "id": run.id,
                "jobId": run.job_id,
                "status": run.status,
                "stepStates": run.step_states,
                "dagSteps": normalize_steps(job.dag_steps) if job else [],
                "triggerType": run.trigger_type,
                "startedAt": run.started_at,
                "finishedAt": run.finished_at,
                "executions": [serialize_execution(e) for e in steps],
            })
        job_id = q(request, "jobId", "job_id")
        from executions.models import WorkflowRun

        if job_id:
            get_owned(IntegrationJob, job_id, request, not_found="任务不存在")
        qs = scope_qs(WorkflowRun.objects.all(), request).order_by("-created_at")
        if job_id:
            qs = qs.filter(job_id=job_id)
        ws = request_workspace_id(request)
        if ws:
            from open_api.tenancy import workspace_job_ids

            qs = qs.filter(job_id__in=workspace_job_ids(ws))
        page = q_int(request, "page", default=1)
        page_size = q_int(request, "pageSize", "page_size", default=20)
        total = qs.count()
        items = qs[(page - 1) * page_size : page * page_size]
        return Response({
            "items": [{
                "id": r.id, "jobId": r.job_id, "status": r.status,
                "stepStates": r.step_states, "triggerType": r.trigger_type,
                "startedAt": r.started_at, "finishedAt": r.finished_at,
            } for r in items],
            "total": total, "page": page, "pageSize": page_size,
        })

    def post(self, request):
        """DAG step 级重跑：POST /api/workflows { id, stepId } 从指定 step 起续跑，
        前面 success step 跳过，目标 + 后继重置为 pending 再入队。"""
        run_id = request.data.get("id") or request.data.get("workflowRunId")
        step_id = request.data.get("stepId") or request.data.get("step_id")
        if not run_id or not step_id:
            raise ApiError("缺少 id 和 stepId", 400)
        from executions.models import WorkflowRun

        run = get_owned(WorkflowRun, run_id, request, not_found="编排运行不存在")
        from core.permissions import has_permission

        auth = getattr(request, "auth_ctx", None)
        if not has_permission(auth, "execution:execute"):
            raise ApiError("缺少 execution:execute 权限", 403)
        from executions.dag import retry_step

        result = retry_step(run.id, str(step_id), triggered_by=getattr(request.auth_ctx, "user_id", "") or "")
        audit_from_request(
            request, action="UPDATE", resource_type="WORKFLOW",
            resource_id=run.id, detail={"action": "retry_step", "stepId": step_id},
        )
        return Response(result)
