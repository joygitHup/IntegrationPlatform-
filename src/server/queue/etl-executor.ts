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
import { desensitizeRecord, computeDataFingerprint, type DesensitizeMode } from '@/server/services/desensitize-service';
import {
  makeSyncDecision,
  type SyncDecision,
} from '@/server/services/sync-engine';
import { createSnapshot } from '@/server/services/version-snapshot-service';
import { recordFieldChangeAudit } from '@/server/services/field-audit-service';
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
// 写入死信队列（自动脱敏）
// ============================================================
export async function addToDeadLetter(params: {
  jobId: string;
  executionId: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  errorType?: string;
  sensitiveFields?: string[];
  desensitizeMode?: DesensitizeMode;
}) {
  const db = getDb();

  // 敏感字段脱敏
  const desensitizedPayload = params.sensitiveFields && params.sensitiveFields.length > 0
    ? desensitizeRecord(params.payload, params.sensitiveFields, params.desensitizeMode || 'mask')
    : params.payload;

  const isDesensitized = !!(params.sensitiveFields && params.sensitiveFields.length > 0);
  const payloadHash = computeDataFingerprint(params.payload);

  await db.insert(deadLetterMessages).values({
    id: generateId('dlq'),
    jobId: params.jobId,
    executionId: params.executionId,
    payload: desensitizedPayload,
    isDesensitized,
    payloadHash,
    errorMessage: params.errorMessage,
    errorType: params.errorType || 'TRANSFORM_ERROR',
    retryCount: 0,
    status: 'pending',
  });
}

// ============================================================
// 构建记录匹配键
// ============================================================
function buildRecordKey(record: Record<string, unknown>, matchKeys: string[]): string {
  if (matchKeys.length === 0) return JSON.stringify(record);
  return matchKeys.map((k) => String(record[k] ?? '')).join('||');
}

// ============================================================
// 构建更新 URL（REST 风格）
// ============================================================
function buildUpdateUrl(baseUrl: string, record: Record<string, unknown>, matchKeys: string[]): string {
  const firstKey = matchKeys[0] || 'id';
  const id = String(record[firstKey] || '');
  const sep = baseUrl.endsWith('/') ? '' : '/';
  return `${baseUrl}${sep}${encodeURIComponent(id)}`;
}

// ============================================================
// 预取目标系统数据用于 upsert 对比
// ============================================================
async function fetchTargetDataForUpsert(
  targetUrl: string,
  targetHeaders: Record<string, string>,
  _sourceRecords: Record<string, unknown>[],
  matchKeys: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  try {
    const listUrl = new URL(targetUrl);
    listUrl.searchParams.set('pageSize', '1000');
    const res = await fetch(listUrl.toString(), { method: 'GET', headers: targetHeaders });
    if (!res.ok) return map;
    const data = await res.json() as Record<string, unknown>;
    let targetRecords: Record<string, unknown>[] = [];
    if (Array.isArray(data)) targetRecords = data;
    else if (Array.isArray(data.data)) targetRecords = data.data as Record<string, unknown>[];
    else if (Array.isArray(data.items)) targetRecords = data.items as Record<string, unknown>[];
    for (const rec of targetRecords) {
      const key = buildRecordKey(rec, matchKeys);
      map.set(key, rec);
    }
  } catch (_e) { /* 获取失败退化为 insert 模式 */ }
  return map;
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
    let result: { totalRows: number; successRows: number; failedRows: number; skippedRows?: number; lastWatermark?: string };

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
): Promise<{ totalRows: number; successRows: number; failedRows: number; skippedRows?: number; lastWatermark?: string }> {
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
  let skippedRows = 0;
  let lastWatermark: string | undefined;

  // 读取增强配置
  const matchKeys = (job.matchKeys as string[]) || [];
  const conflictStrategy = (job.conflictStrategy as string) || 'source_wins';
  const sensitiveFields = (job.sensitiveFields as string[]) || [];
  const desensitizeMode = (job.desensitizeMode as DesensitizeMode) || 'mask';
  const enableChangeAudit = !!job.enableChangeAudit;
  const enableVersionSnapshot = !!job.enableVersionSnapshot;

  // 版本快照 - 执行前（如果启用）
  if (enableVersionSnapshot) {
    try {
      await createSnapshot({
        jobId: job.id,
        executionId: '',
        snapshotType: 'before',
        data: records,
        retentionDays: job.versionRetentionDays || 30,
      });
    } catch (_e) {
      // 快照失败不影响主流程
    }
  }

  // 2. 字段映射
  const { success: mappedRecords, failed: transformFailed } = transformBatch(records, job.fieldMapping || []);
  failedRows += transformFailed.length;

  // 记录转换失败的数据到 DLQ（自动脱敏）
  for (const failed of transformFailed) {
    await addToDeadLetter({
      jobId: job.id,
      executionId: '', // 由调用方补充，这里省略
      payload: failed.record,
      errorMessage: failed.error,
      errorType: 'TRANSFORM_ERROR',
      sensitiveFields,
      desensitizeMode,
    });
  }

  // 3. 同步决策与写入目标
  const targetUrl = buildUrl(targetCfg.baseUrl, targetCfg.path || '');
  const targetHeaders = {
    ...buildApiHeaders(targetCfg),
    'Content-Type': 'application/json',
  };
  const targetMethod = (targetCfg.method as string) || 'POST';
  const writeMode = (job.writeMode as string) || 'insert';

  // 预取目标数据（用于 upsert 模式时的对比）
  let targetDataMap = new Map<string, Record<string, unknown>>();
  if (writeMode !== 'insert' && matchKeys.length > 0) {
    targetDataMap = await fetchTargetDataForUpsert(
      targetUrl, targetHeaders, mappedRecords, matchKeys,
    );
  }

  // 映射源记录到目标索引（通过 matchKeys 对应）
  const sourceKeyToRecord = new Map<string, { source: Record<string, unknown>; mapped: Record<string, unknown> }>();
  for (let i = 0; i < records.length; i++) {
    if (mappedRecords[i]) {
      const key = buildRecordKey(mappedRecords[i], matchKeys);
      sourceKeyToRecord.set(key, { source: records[i], mapped: mappedRecords[i] });
    }
  }

  // 批次写入
  const batchSize = job.batchSize || 100;
  for (let i = 0; i < mappedRecords.length; i += batchSize) {
    const batch = mappedRecords.slice(i, i + batchSize);
    for (const record of batch) {
      try {
        const recordKey = buildRecordKey(record, matchKeys);
        const targetRecord = targetDataMap.get(recordKey);
        const sourceRec = sourceKeyToRecord.get(recordKey)?.source || record;

        // 同步决策
        const decision = makeSyncDecision({
          jobId: job.id,
          executionId: '',
          sourceRecord: record,
          targetRecord,
          matchKeys,
          conflictStrategy: conflictStrategy as 'source_wins' | 'target_wins' | 'newest_wins' | 'manual',
          conflictCompareField: job.conflictCompareField || undefined,
          enableChangeAudit,
        });

        // 根据决策执行操作
        let writeSuccess = false;

        switch (decision.operation) {
          case 'create': {
            if (writeMode === 'update_only') {
              skippedRows++;
              break;
            }
            // 写入创建请求
            const createRes = await fetch(targetUrl, {
              method: targetMethod,
              headers: targetHeaders,
              body: JSON.stringify(record),
            });
            writeSuccess = createRes.ok;

            if (!writeSuccess) {
              const errText = await createRes.text().catch(() => '');
              throw new Error(`创建失败: HTTP ${createRes.status} ${errText}`);
            }

            // 变更审计
            if (enableChangeAudit) {
              await recordFieldChangeAudit({
                jobId: job.id,
                executionId: '',
                recordKey,
                operation: 'create',
                changes: Object.keys(record).map((f) => ({ field: f, oldValue: null, newValue: record[f] })),
                beforeRecord: null,
                afterRecord: record,
              }).catch(() => {}); // 审计失败不影响主流程
            }
            break;
          }

          case 'update': {
            if (writeMode === 'insert') {
              // insert 模式遇到已存在 → 跳过（不覆盖）
              skippedRows++;
              break;
            }

            // 构建更新 URL（假设 REST 风格，通过 match key 追加到 path）
            const updateUrl = buildUpdateUrl(targetUrl, record, matchKeys);
            const updateRes = await fetch(updateUrl, {
              method: 'PUT',
              headers: targetHeaders,
              body: JSON.stringify(record),
            });
            writeSuccess = updateRes.ok;

            if (!writeSuccess) {
              const errText = await updateRes.text().catch(() => '');
              throw new Error(`更新失败: HTTP ${updateRes.status} ${errText}`);
            }

            // 变更审计
            if (enableChangeAudit && decision.changedFields && decision.changedFields.length > 0) {
              await recordFieldChangeAudit({
                jobId: job.id,
                executionId: '',
                recordKey,
                operation: 'update',
                changes: decision.changedFields,
                beforeRecord: targetRecord ?? null,
                afterRecord: record,
              }).catch(() => {});
            }
            break;
          }

          case 'skip_identical':
          case 'skip_conflict': {
            skippedRows++;
            break;
          }
        }

        if (decision.operation === 'create' || decision.operation === 'update') {
          successRows++;
        }

        // 更新水位
        if (decision.operation !== 'skip_conflict' && job.syncMode === 'incremental' && job.watermarkField) {
          const wmVal = String(sourceRec[job.watermarkField] || '');
          if (!lastWatermark || wmVal > lastWatermark) {
            lastWatermark = wmVal;
          }
        }

      } catch (writeError) {
        failedRows++;
        await addToDeadLetter({
          jobId: job.id,
          executionId: '',
          payload: record,
          errorMessage: `写入异常: ${(writeError as Error).message}`,
          errorType: 'WRITE_ERROR',
          sensitiveFields,
          desensitizeMode,
        });
      }
    }
  }

  return { totalRows, successRows, failedRows, skippedRows, lastWatermark };
}

// ============================================================
// HTTP 源提取（通用目标）
// ============================================================
async function executeHttpExtract(
  job: typeof integrationJobs.$inferSelect,
  sourceConfig: Record<string, unknown>,
  _targetDs: { type: string; config: Record<string, unknown> },
): Promise<{ totalRows: number; successRows: number; failedRows: number; skippedRows?: number; lastWatermark?: string }> {
  // 简化处理：对于非 HTTP 目标，模拟执行（实际生产环境需要对应目标的 writer）
  return executeMockETL(job);
}

// ============================================================
// 模拟 ETL（用于演示和无驱动场景）
// ============================================================
async function executeMockETL(
  job: typeof integrationJobs.$inferSelect,
): Promise<{ totalRows: number; successRows: number; failedRows: number; skippedRows?: number; lastWatermark?: string }> {
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
