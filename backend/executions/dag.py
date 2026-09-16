"""DAG 多步编排：按 dependsOn 调度后续步骤。"""
from __future__ import annotations

import logging
from typing import Any

from django.utils import timezone

logger = logging.getLogger(__name__)


def normalize_steps(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    steps = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id") or item.get("code") or "").strip()
        if not sid:
            continue
        depends = item.get("dependsOn") or item.get("depends_on") or []
        if isinstance(depends, str):
            depends = [x.strip() for x in depends.replace(",", " ").split() if x.strip()]
        steps.append({
            **item,
            "id": sid,
            "name": item.get("name") or sid,
            "dependsOn": [str(x) for x in depends],
        })
    return steps


def has_cycle(steps: list[dict]) -> bool:
    graph = {s["id"]: [d for d in (s.get("dependsOn") or []) if d != s["id"]] for s in steps}
    color: dict[str, int] = {}

    def visit(node: str) -> bool:
        color[node] = 1
        for dep in graph.get(node, []):
            if dep not in graph:
                continue
            state = color.get(dep, 0)
            if state == 1:
                return True
            if state == 0 and visit(dep):
                return True
        color[node] = 2
        return False

    return any(color.get(node, 0) == 0 and visit(node) for node in graph)


def has_dag(job) -> bool:
    return bool(normalize_steps(getattr(job, "dag_steps", None)))


def ready_steps(steps: list[dict], states: dict[str, str]) -> list[dict]:
    done = {k for k, v in states.items() if v == "success"}
    running_or_done = {k for k, v in states.items() if v in ("success", "running", "failed")}
    ready = []
    for step in steps:
        sid = step["id"]
        if sid in running_or_done:
            continue
        deps = step.get("dependsOn") or []
        if all(d in done for d in deps):
            ready.append(step)
    return ready


def start_workflow(job, *, trigger_type: str, triggered_by: str = "", payload=None) -> dict:
    from executions.models import WorkflowRun

    steps = normalize_steps(job.dag_steps)
    if not steps:
        from executions.services import enqueue_execution as _enq

        return _enq(job, trigger_type=trigger_type, triggered_by=triggered_by, payload=payload)
    run = WorkflowRun.objects.create(
        job_id=job.id,
        trigger_type=trigger_type,
        triggered_by=triggered_by or "",
        status="running",
        step_states={s["id"]: "pending" for s in steps},
        started_at=timezone.now(),
    )
    first = ready_steps(steps, run.step_states)
    queued = []
    for step in first:
        queued.append(_enqueue_step(job, run, step, trigger_type, triggered_by, payload if not step.get("dependsOn") else None))
    if not queued:
        run.status = "failed"
        run.finished_at = timezone.now()
        run.save(update_fields=["status", "finished_at", "updated_at"])
        from core.exceptions import ApiError

        raise ApiError("DAG 没有可执行的起始步骤（可能存在环）", 400)
    return {
        "workflowRunId": run.id,
        "executionId": queued[0]["executionId"],
        "queueJobId": queued[0]["queueJobId"],
        "status": "queued",
        "stepsQueued": [q["stepId"] for q in queued],
    }


def _enqueue_step(job, run, step: dict, trigger_type: str, triggered_by: str, payload) -> dict:
    from executions.models import JobExecution
    from executions.queue import get_queue

    exe = JobExecution.objects.create(
        job_id=job.id,
        trigger_type=trigger_type,
        triggered_by=triggered_by or "",
        status="pending",
        workflow_run_id=run.id,
        step_id=step["id"],
    )
    execution_id = exe.id
    item: dict[str, Any] = {
        "jobId": job.id,
        "executionId": execution_id,
        "triggerType": trigger_type,
        "triggeredBy": triggered_by,
        "workflowRunId": run.id,
        "step": step,
        "stepId": step["id"],
    }
    if step.get("jobId"):
        item["delegateJobId"] = step["jobId"]
    if payload is not None:
        item["payload"] = payload
    qid = get_queue().add(item)
    JobExecution.objects.filter(id=execution_id).update(queue_job_id=qid)
    states = dict(run.step_states or {})
    states[step["id"]] = "running"
    run.step_states = states
    run.save(update_fields=["step_states", "updated_at"])
    from monitor.metrics import observe_enqueue
    from django.conf import settings

    observe_enqueue(backend=getattr(settings, "QUEUE_BACKEND", "memory"), environment=getattr(job, "environment", "") or "dev")
    return {"executionId": execution_id, "queueJobId": qid, "stepId": step["id"]}


def on_step_finished(job_data: dict, result: dict) -> None:
    run_id = job_data.get("workflowRunId")
    step_id = job_data.get("stepId")
    if not run_id or not step_id:
        return
    from executions.models import WorkflowRun
    from jobs.models import IntegrationJob

    run = WorkflowRun.objects.filter(id=run_id).first()
    if not run:
        return
    job = IntegrationJob.objects.filter(id=run.job_id).first()
    if not job:
        return
    states = dict(run.step_states or {})
    ok = bool(result.get("ok")) and (result.get("status") != "failed")
    states[step_id] = "success" if ok else "failed"
    run.step_states = states
    if not ok:
        run.status = "failed"
        run.finished_at = timezone.now()
        run.save(update_fields=["step_states", "status", "finished_at", "updated_at"])
        from executions.events import emit_job_event

        emit_job_event(job, status="failed", triggered_by=job.code)
        return
    steps = normalize_steps(job.dag_steps)
    nxt = ready_steps(steps, states)
    for step in nxt:
        _enqueue_step(job, run, step, run.trigger_type, run.triggered_by, None)
    pending = [s["id"] for s in steps if states.get(s["id"]) not in ("success", "failed")]
    if not pending:
        run.status = "success"
        run.finished_at = timezone.now()
    run.save(update_fields=["step_states", "status", "finished_at", "updated_at"])
    if not pending:
        from executions.events import emit_job_event

        emit_job_event(job, status="success", triggered_by=job.code)
