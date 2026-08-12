import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { getJobById, updateJob, deleteJob } from '@/server/services/job-service';
import { recordAuditLog } from '@/server/services/audit-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'job:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const job = await getJobById(id);
  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  return NextResponse.json(job);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'job:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const job = await updateJob(id, body);
    if (!job) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'UPDATE',
      resourceType: 'JOB',
      resourceId: id,
      resourceName: job.name,
      detail: { updatedFields: Object.keys(body) },
      ip: auth.ip,
      userAgent: auth.userAgent,
      traceId: auth.traceId,
    });

    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'job:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const job = await getJobById(id);
  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  await deleteJob(id);

  await recordAuditLog({
    userId: auth.userId,
    username: auth.username,
    action: 'DELETE',
    resourceType: 'JOB',
    resourceId: id,
    resourceName: job.name,
    ip: auth.ip,
    userAgent: auth.userAgent,
    traceId: auth.traceId,
  });

  return NextResponse.json({ success: true });
}
