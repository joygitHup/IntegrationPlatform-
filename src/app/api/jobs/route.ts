import { NextRequest, NextResponse } from 'next/server';
import { authenticate, hasPermission } from '@/server/utils/auth';
import { listJobs, createJob } from '@/server/services/job-service';
import { recordAuditLog } from '@/server/services/audit-service';
import { z } from 'zod';

const createJobSchema = z.object({
  name: z.string().min(1).max(128),
  code: z.string().min(1).max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  description: z.string().max(255).optional(),
  sourceDatasourceId: z.string().min(1),
  targetDatasourceId: z.string().min(1),
  sourceConfig: z.record(z.string(), z.any()).default({}),
  targetConfig: z.record(z.string(), z.any()).default({}),
  fieldMapping: z.array(z.any()).default([]),
  filterCondition: z.string().max(1024).optional(),
  syncMode: z.enum(['full', 'incremental']).default('full'),
  watermarkField: z.string().max(64).optional(),
  watermarkValue: z.string().max(128).optional(),
  scheduleType: z.enum(['manual', 'cron', 'event', 'webhook']).default('manual'),
  scheduleCron: z.string().max(64).optional(),
  batchSize: z.number().int().positive().max(100000).default(1000),
  concurrency: z.number().int().positive().max(32).default(1),
  retryCount: z.number().int().min(0).max(10).default(3),
  retryInterval: z.number().int().min(0).max(86400).default(60),
});

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'job:read')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const keyword = searchParams.get('keyword') || undefined;
  const status = searchParams.get('status') || undefined;
  const syncMode = searchParams.get('syncMode') || undefined;

  const result = await listJobs({ page, pageSize, keyword, status, syncMode });
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(auth, 'job:write')) {
    return NextResponse.json({ error: '权限不足' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数错误', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const job = await createJob({
      ...parsed.data,
      createdBy: auth.userId,
    });

    await recordAuditLog({
      userId: auth.userId,
      username: auth.username,
      action: 'CREATE',
      resourceType: 'JOB',
      resourceId: job?.id,
      resourceName: job?.name,
      detail: { code: job?.code, syncMode: job?.syncMode },
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
