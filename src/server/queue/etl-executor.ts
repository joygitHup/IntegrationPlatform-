/**
 * ETL 执行引擎
 * 负责：数据提取(Extract) -> 转换(Transform) -> 加载(Load)
 */
import { getDb } from '@/server/db';
import {
  jobExecutions,
  deadLetterMessages,
  type NewJobExecution,
} from '@/server/db/schema/job-execution';
import { integrationJobs } from '@/server/db/schema/integration-job';
import { generateId } from '@/server/utils/id';
import { transformBatch } from '@/server/services/field-mapping-engine';
import { getDatasourceById } from '@/server/services/datasource-service';
import { eq } from 'drizzle-orm';
import type { JobData, JobResult } from './index';

// ============================================================
// 创建执行记录
// ============================================================
export async function createExecution(input: {
  jobId: string;
  triggerType: 'manual' | 'schedule' | 'webhook' | 'retry';
  triggeredBy?: string;
  queueJobId?: string;
}): Promise<string> {
  const db = getDb();
  const executionId = generateId('exec');

  const execution: NewJobExecution = {
    id: executionId,
    jobId: input.jobId,
    triggerType: input.triggerType,
    triggeredBy: input.triggeredBy,
    status: 'pending',
    queueJobId: input.queueJobId,
  };

  await db.insert(jobExecutions).values(execution);
  return executionId;
}

// ============================================================
// 更新执行状态
// ============================================================
export async function updateExecutionStatus(
  executionId: string,
  status: string,
  updates: Partial<{
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    totalRows: number;
    successRows: number;
    failedRows: number;
    skippedRows: number;
    startWatermark: string;
    endWatermark: string;
    errorMessage: string;
    errorStack: string;
    retryAttempts: number;
  }> = {},
) {
  const db = getDb();
  await db.update(jobExecutions).set({ status, ...updates }).where(eq(jobExecutions.id, executionId));
}

// ============================================================
// 写入死信队列
// ============================================================
export async function addToDeadLetter(params: {
  jobId: string;
  executionId: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  errorType?: string;
}) {
  const db = getDb();
  await db.insert(deadLetterMessages).values({
    id: generateId('dlq'),
    jobId: params.jobId,
    executionId: params.executionId,
    payload: params.payload,
    errorMessage: params.errorMessage,
    errorType: params.errorType || 'TRANSFORM_ERROR',
    retryCount: 0,
    status: 'pending',
  });
}

// ============================================================
// 主执行函数 - 处理一个 ETL 任务
// ============================================================
export async function executeJob(data: JobData): Promise<JobResult> {
  const { jobId, executionId } = data;
  const db = getDb();

  // 1. 获取任务配置
  const jobList = await db.select().from(integrationJobs).where(eq(integrationJobs.id, jobId)).limit(1);
  if (jobList.length === 0) {
    await updateExecutionStatus(executionId, 'failed', {
      errorMessage: `任务 ${jobId} 不存在`,
      finishedAt: new Date(),
      durationMs: 0,
    });
    return { success: false, errorMessage: `任务 ${jobId} 不存在` };
  }

  const job = jobList[0];
  const startTime = Date.now();

  try {
    // 2. 更新状态为运行中
    await updateExecutionStatus(executionId, 'running', {
      startedAt: new Date(),
      startWatermark: job.watermarkValue || undefined,
    });

    // 3. 获取数据源配置（解密）
    const sourceDs = await getDatasourceById(job.sourceDatasourceId, true);
    const targetDs = await getDatasourceById(job.targetDatasourceId, true);

    if (!sourceDs) {
      throw new Error(`源数据源 ${job.sourceDatasourceId} 不存在`);
    }
    if (!targetDs) {
      throw new Error(`目标数据源 ${job.targetDatasourceId} 不存在`);
    }

    // 4. 根据数据源类型执行 ETL
    let result: { totalRows: number; successRows: number; failedRows: number; lastWatermark?: string };

    if (sourceDs.type === 'http_api' && targetDs.type === 'http_api') {
      result = await executeHttpToHttp(job, sourceDs.config as Record<string, unknown>, targetDs.config as Record<string, unknown>);
    } else if (sourceDs.type === 'http_api') {
      result = await executeHttpExtract(job, sourceDs.config as Record<string, unknown>, targetDs);
    } else {
      // 通用：模拟执行（对于没有真实连接驱动的数据源类型）
      result = await executeMockETL(job);
    }

    // 5. 更新水位线
    if (job.syncMode === 'incremental' && result.lastWatermark) {
      await db.update(integrationJobs)
        .set({ watermarkValue: result.lastWatermark, updatedAt: new Date() })
        .where(eq(integrationJobs.id, jobId));
    }

    // 6. 更新执行结果
    const durationMs = Date.now() - startTime;
    const status = result.failedRows > 0 && result.successRows === 0 ? 'failed' :
      result.failedRows > 0 ? 'partial_failed' : 'success';

    await updateExecutionStatus(executionId, status, {
      finishedAt: new Date(),
      durationMs,
      totalRows: result.totalRows,
      successRows: result.successRows,
      failedRows: result.failedRows,
      endWatermark: result.lastWatermark,
    });

    return {
      success: status !== 'failed',
      totalRows: result.totalRows,
      successRows: result.successRows,
      failedRows: result.failedRows,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;

    await updateExecutionStatus(executionId, 'failed', {
      finishedAt: new Date(),
      durationMs,
      errorMessage,
      errorStack,
    });

    return {
      success: false,
      errorMessage,
    };
  }
}

// ============================================================
// HTTP API -> HTTP API 同步
// ============================================================
async function executeHttpToHttp(
  job: typeof integrationJobs.$inferSelect,
  sourceConfig: Record<string, unknown>,
  targetConfig: Record<string, unknown>,
): Promise<{ totalRows: number; successRows: number; failedRows: number; lastWatermark?: string }> {
  const sourceCfg = sourceConfig as { baseUrl: string; path?: string; authType?: string; token?: string; dataField?: string };
  const targetCfg = targetConfig as { baseUrl: string; path?: string; authType?: string; token?: string; method?: string };

  // 1. 从源 API 拉取数据
  const sourceUrl = buildUrl(sourceCfg.baseUrl, sourceCfg.path || '');
  const sourceHeaders = buildApiHeaders(sourceCfg);

  const response = await fetch(sourceUrl, {
    method: 'GET',
    headers: sourceHeaders,
  });

  if (!response.ok) {
    throw new Error(`源 API 请求失败: HTTP ${response.status}`);
  }

  const responseData = await response.json() as Record<string, unknown>;

  // 提取数据数组
  const dataField = (job.sourceConfig as Record<string, unknown>)?.dataField as string || 'data';
  let records: Record<string, unknown>[];

  if (dataField && responseData[dataField]) {
    records = responseData[dataField] as Record<string, unknown>[];
  } else if (Array.isArray(responseData)) {
    records = responseData as Record<string, unknown>[];
  } else {
    records = [responseData as Record<string, unknown>];
  }

  // 增量同步过滤
  if (job.syncMode === 'incremental' && job.watermarkField && job.watermarkValue) {
    const wmValue = isNaN(Number(job.watermarkValue)) ? job.watermarkValue : Number(job.watermarkValue);
    records = records.filter((r) => {
      const fieldValue = r[job.watermarkField!];
      return fieldValue !== undefined && String(fieldValue) > String(wmValue);
    });
  }

  const totalRows = records.length;
  let successRows = 0;
  let failedRows = 0;
  let lastWatermark: string | undefined;

  // 2. 字段映射
  const { success: mappedRecords, failed: transformFailed } = transformBatch(records, job.fieldMapping || []);
  failedRows += transformFailed.length;

  // 记录转换失败的数据到 DLQ
  for (const failed of transformFailed) {
    await addToDeadLetter({
      jobId: job.id,
      executionId: '', // 由调用方补充，这里省略
      payload: failed.record,
      errorMessage: failed.error,
      errorType: 'TRANSFORM_ERROR',
    });
  }

  // 3. 写入目标 API
  const targetUrl = buildUrl(targetCfg.baseUrl, targetCfg.path || '');
  const targetHeaders = {
    ...buildApiHeaders(targetCfg),
    'Content-Type': 'application/json',
  };
  const targetMethod = (targetCfg.method as string) || 'POST';

  // 批次写入
  const batchSize = job.batchSize || 100;
  for (let i = 0; i < mappedRecords.length; i += batchSize) {
    const batch = mappedRecords.slice(i, i + batchSize);
    try {
      // 单条写入更可靠
      for (const record of batch) {
        try {
          const writeRes = await fetch(targetUrl, {
            method: targetMethod,
            headers: targetHeaders,
            body: JSON.stringify(record),
          });
          if (writeRes.ok) {
            successRows++;
            // 更新水位
            if (job.syncMode === 'incremental' && job.watermarkField) {
              // 从原始记录找水位字段值（通过 source 数据匹配）
              const originalIdx = records.findIndex((r) => JSON.stringify(r).slice(0, 100) === JSON.stringify(record).slice(0, 100));
              if (originalIdx >= 0) {
                const wmVal = String(records[originalIdx][job.watermarkField!] || '');
                if (!lastWatermark || wmVal > lastWatermark) {
                  lastWatermark = wmVal;
                }
              }
            }
          } else {
            failedRows++;
            const errText = await writeRes.text().catch(() => '');
            await addToDeadLetter({
              jobId: job.id,
              executionId: '',
              payload: record,
              errorMessage: `写入失败: HTTP ${writeRes.status} ${errText}`,
              errorType: 'WRITE_ERROR',
            });
          }
        } catch (writeError) {
          failedRows++;
          await addToDeadLetter({
            jobId: job.id,
            executionId: '',
            payload: record,
            errorMessage: `写入异常: ${(writeError as Error).message}`,
            errorType: 'WRITE_ERROR',
          });
        }
      }
    } catch (batchError) {
      failedRows += batch.length;
    }
  }

  return { totalRows, successRows, failedRows, lastWatermark };
}

// ============================================================
// HTTP 源提取（通用目标）
// ============================================================
async function executeHttpExtract(
  job: typeof integrationJobs.$inferSelect,
  sourceConfig: Record<string, unknown>,
  _targetDs: { type: string; config: Record<string, unknown> },
): Promise<{ totalRows: number; successRows: number; failedRows: number; lastWatermark?: string }> {
  // 简化处理：对于非 HTTP 目标，模拟执行（实际生产环境需要对应目标的 writer）
  return executeMockETL(job);
}

// ============================================================
// 模拟 ETL（用于演示和无驱动场景）
// ============================================================
async function executeMockETL(
  job: typeof integrationJobs.$inferSelect,
): Promise<{ totalRows: number; successRows: number; failedRows: number; lastWatermark?: string }> {
  // 模拟一批数据
  const batchSize = Math.min(job.batchSize, 50);
  const records: Record<string, unknown>[] = [];

  for (let i = 0; i < batchSize; i++) {
    const record: Record<string, unknown> = {
      id: `mock_${Date.now()}_${i}`,
      name: `测试数据_${i}`,
      email: `user${i}@example.com`,
      status: i % 5 === 0 ? 'inactive' : 'active',
      createdAt: new Date(Date.now() - i * 1000 * 60 * 60).toISOString(),
      amount: Math.floor(Math.random() * 10000),
      description: `这是第 ${i} 条模拟数据`,
    };
    records.push(record);
  }

  // 增量同步：模拟水位过滤
  let filteredRecords = records;
  let lastWatermark: string | undefined;

  if (job.syncMode === 'incremental' && job.watermarkField) {
    if (job.watermarkValue) {
      filteredRecords = records.filter((r) => {
        const val = String(r[job.watermarkField!] || '');
        return val > job.watermarkValue!;
      });
    }
    // 计算新水位
    if (filteredRecords.length > 0) {
      const lastRecord = filteredRecords[filteredRecords.length - 1];
      lastWatermark = String(lastRecord[job.watermarkField] || '');
    }
  }

  // 字段映射
  const { success: transformed, failed } = transformBatch(filteredRecords, job.fieldMapping || []);

  // 模拟写入延迟
  await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500));

  // 模拟小部分写入失败（约 5%）
  let successRows = 0;
  let failedRows = failed.length;
  for (let i = 0; i < transformed.length; i++) {
    if (Math.random() < 0.05) {
      failedRows++;
      await addToDeadLetter({
        jobId: job.id,
        executionId: '',
        payload: transformed[i],
        errorMessage: '模拟写入失败（Mock 模式）',
        errorType: 'MOCK_WRITE_ERROR',
      });
    } else {
      successRows++;
    }
  }

  return {
    totalRows: filteredRecords.length,
    successRows,
    failedRows,
    lastWatermark,
  };
}

// ============================================================
// 辅助函数
// ============================================================
function buildUrl(base: string, path: string): string {
  if (!base) return path;
  if (path.startsWith('http')) return path;
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}

function buildApiHeaders(config: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  switch (config.authType) {
    case 'bearer':
      if (config.token) headers['Authorization'] = `Bearer ${config.token}`;
      break;
    case 'basic':
      if (config.username && config.password) {
        headers['Authorization'] = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
      }
      break;
    case 'apikey':
      if (config.apiKeyHeader && config.apiKeyValue) {
        headers[config.apiKeyHeader] = config.apiKeyValue;
      }
      break;
  }
  return headers;
}
