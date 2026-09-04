import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import {
  listDepartments,
  getDepartment,
  createDepartment,
  getDepartmentTree,
  listDepartmentUsers,
} from '@/server/services/org-sync-service';

// GET /api/org-departments - 部门列表/树/部门用户
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId') || undefined;
  const tree = searchParams.get('tree') === 'true';
  const deptId = searchParams.get('id');
  const usersOfDept = searchParams.get('users');

  if (deptId) {
    const dept = await getDepartment(deptId);
    if (!dept) {
      return NextResponse.json({ error: '部门不存在' }, { status: 404 });
    }
    return NextResponse.json({ data: dept });
  }

  if (usersOfDept && jobId) {
    const users = await listDepartmentUsers({
      jobId,
      deptSourceId: usersOfDept,
      includeSubDepartments: searchParams.get('includeSub') === 'true',
    });
    return NextResponse.json({ items: users, total: users.length });
  }

  if (tree && jobId) {
    const result = await getDepartmentTree(jobId);
    return NextResponse.json({ items: result });
  }

  if (!jobId) {
    return NextResponse.json({ error: '缺少 jobId 参数' }, { status: 400 });
  }

  const result = await listDepartments({ jobId });
  return NextResponse.json({ items: result, total: result.length, page: 1, pageSize: result.length });
}

// POST /api/org-departments - 创建部门
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.jobId) {
    return NextResponse.json({ error: '缺少 jobId' }, { status: 400 });
  }
  const id = await createDepartment({
    jobId: body.jobId as string,
    sourceId: body.sourceId,
    code: body.code,
    name: body.name,
    parentSourceId: body.parentSourceId,
    fullName: body.fullName,
    level: body.level,
    sortOrder: body.sortOrder,
    manager: body.manager,
    status: body.status,
    attributes: body.attributes,
  });

  const dept = await getDepartment(id);
  return NextResponse.json({ data: dept }, { status: 201 });
}
