"""部门树与组织同步。"""
from __future__ import annotations

from org_sync.models import Department, DeptSyncExecution, UserDepartment


def list_departments(job_id: str) -> list[Department]:
    return list(Department.objects.filter(job_id=job_id).order_by("sort_order", "name"))


def get_department_tree(job_id: str) -> list[dict]:
    depts = list_departments(job_id)
    by_source = {d.source_id: {
        "id": d.id, "jobId": d.job_id, "sourceId": d.source_id, "code": d.code,
        "name": d.name, "fullName": d.full_name, "parentSourceId": d.parent_source_id,
        "path": d.path, "depth": d.depth, "sortOrder": d.sort_order, "manager": d.manager,
        "status": d.status, "children": [],
    } for d in depts}
    roots = []
    for node in by_source.values():
        parent = node["parentSourceId"]
        if parent and parent in by_source:
            by_source[parent]["children"].append(node)
        else:
            roots.append(node)
    return roots


def create_department(data: dict) -> Department:
    parent = data.get("parentSourceId") or data.get("parent_source_id") or ""
    depth = int(data.get("level") or data.get("depth") or 0)
    path = data.get("path") or ""
    if parent:
        p = Department.objects.filter(job_id=data["jobId"], source_id=parent).first()
        if p:
            depth = p.depth + 1
            path = f"{p.path}/{data.get('code') or data.get('sourceId')}"
    obj = Department.objects.create(
        job_id=data["jobId"],
        source_id=data.get("sourceId") or data.get("code"),
        code=data.get("code") or "",
        name=data.get("name") or "",
        full_name=data.get("fullName") or data.get("name") or "",
        parent_source_id=parent,
        path=path,
        depth=depth,
        sort_order=data.get("sortOrder") or 0,
        manager=data.get("manager") or "",
        status=data.get("status") or "active",
        attributes=data.get("attributes") or {},
        data_source="manual",
    )
    return obj


def _resolve_dept_source_id(job_id: str, raw: str) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    if Department.objects.filter(job_id=job_id, source_id=value).exists():
        return value
    existing = (
        Department.objects.filter(job_id=job_id, code=value).first()
        or Department.objects.filter(job_id=job_id, name=value).first()
    )
    if existing:
        return existing.source_id
    Department.objects.create(
        job_id=job_id,
        source_id=value,
        code=value,
        name=value,
        full_name=value,
        data_source="source",
    )
    return value


def sync_user_departments(*, job_id: str, users: list[dict], mode: str = "full") -> dict:
    created = updated = skipped = 0
    keep: set[tuple[str, str]] = set()
    for item in users or []:
        user_id = str(item.get("id") or item.get("userId") or item.get("username") or "").strip()
        if not user_id:
            skipped += 1
            continue
        raw_depts = item.get("departmentIds") or item.get("department") or item.get("deptIds") or []
        if isinstance(raw_depts, (str, int)):
            raw_depts = [raw_depts]
        title = str(item.get("title") or item.get("position") or "")
        if not raw_depts:
            skipped += 1
            continue
        for index, raw in enumerate(raw_depts):
            dept_id = _resolve_dept_source_id(job_id, str(raw))
            if not dept_id:
                skipped += 1
                continue
            keep.add((user_id, dept_id))
            existing = UserDepartment.objects.filter(
                job_id=job_id, user_source_id=user_id, dept_source_id=dept_id
            ).first()
            if existing:
                existing.is_primary = index == 0
                existing.position = title
                existing.save(update_fields=["is_primary", "position"])
                updated += 1
            else:
                UserDepartment.objects.create(
                    job_id=job_id,
                    user_source_id=user_id,
                    dept_source_id=dept_id,
                    is_primary=index == 0,
                    position=title,
                )
                created += 1
    deleted = 0
    if mode == "full":
        for row in UserDepartment.objects.filter(job_id=job_id):
            if (row.user_source_id, row.dept_source_id) not in keep:
                row.delete()
                deleted += 1
    DeptSyncExecution.objects.create(
        job_id=job_id,
        execution_id="",
        phase="user_dept",
        total_count=len(users or []),
        created_count=created,
        updated_count=updated,
        deleted_count=deleted,
        skipped_count=skipped,
    )
    return {
        "created": created,
        "updated": updated,
        "deleted": deleted,
        "skipped": skipped,
        "total": len(users or []),
    }


def sync_org_from_source(*, job_id: str, departments: list[dict], mode: str = "incremental") -> dict:
    created = updated = skipped = 0
    for item in departments:
        source_id = str(item.get("sourceId") or item.get("id") or item.get("code") or "")
        if not source_id:
            skipped += 1
            continue
        existing = Department.objects.filter(job_id=job_id, source_id=source_id).first()
        fields = {
            "code": item.get("code") or source_id,
            "name": item.get("name") or "",
            "full_name": item.get("fullName") or item.get("name") or "",
            "parent_source_id": item.get("parentSourceId") or item.get("parentId") or "",
            "sort_order": item.get("sortOrder") or item.get("order") or 0,
            "manager": item.get("manager") or "",
            "status": item.get("status") or "active",
            "attributes": item.get("attributes") or {},
            "data_source": "source",
        }
        if existing:
            if mode == "full" or True:
                for k, v in fields.items():
                    setattr(existing, k, v)
                existing.save()
                updated += 1
        else:
            Department.objects.create(job_id=job_id, source_id=source_id, **fields)
            created += 1
    DeptSyncExecution.objects.create(
        job_id=job_id, execution_id="", phase="dept",
        total_count=len(departments), created_count=created,
        updated_count=updated, skipped_count=skipped,
    )
    return {"created": created, "updated": updated, "skipped": skipped, "total": len(departments)}


def list_department_users(*, job_id: str, dept_source_id: str, include_sub: bool = False):
    dept_ids = {dept_source_id}
    if include_sub:
        for d in Department.objects.filter(job_id=job_id):
            if d.parent_source_id == dept_source_id or (d.path and f"/{dept_source_id}/" in f"/{d.path}/"):
                dept_ids.add(d.source_id)
    return list(UserDepartment.objects.filter(job_id=job_id, dept_source_id__in=dept_ids))
