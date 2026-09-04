import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/server/utils/auth';
import { listSnapshots, getSnapshotData, generateRollbackPlan, deleteSnapshot } from '@/server/services/version-snapshot-service';

// GET /api/version-snapshots - 快照列表 / 详情 / Diff
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get('id');
  const diff = searchParams.get('diff') === 'true';

  if (snapshotId) {
    const data = await getSnapshotData(snapshotId);
    if (!data) {
      return NextResponse.json({ error: '快照不存在' }, { status: 404 });
    }
    return NextResponse.json({ data });
  }

  const jobId = searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: '缺少 jobId 参数' }, { status: 400 });
  }

  const result = await listSnapshots({
    jobId,
    snapshotType: (searchParams.get('snapshotType') as 'before' | 'after') || undefined,
    page: parseInt(searchParams.get('page') || '1'),
    pageSize: parseInt(searchParams.get('pageSize') || '20'),
  });

  return NextResponse.json(result);
}

// POST /api/version-snapshots/rollback - 生成回滚计划
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json();
  const plan = await generateRollbackPlan({
    jobId: body.jobId,
    targetVersion: body.targetVersion || 1,
    snapshotType: body.snapshotType || 'before',
  });

  return NextResponse.json({ plan });
}

// DELETE /api/version-snapshots - 删除快照
export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const snapshotId = searchParams.get('id');
  if (!snapshotId) {
    return NextResponse.json({ error: '缺少快照 ID' }, { status: 400 });
  }

  await deleteSnapshot(snapshotId);
  return NextResponse.json({ success: true });
}
