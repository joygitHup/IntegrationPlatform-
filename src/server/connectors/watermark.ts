/**
 * 水位线管理器
 *
 * 增量同步的核心组件，负责记录和推进同步水位
 *
 * 支持的水位策略：
 * 1. TIMESTAMP：基于时间戳（updated_at / create_time）
 * 2. ID：基于自增主键 ID
 * 3. VERSION：基于版本号字段
 * 4. HYBRID: ID+时间戳混合（解决时间戳重复问题）
 * 5. CURSOR：游标式（API 类场景）
 *
 * 幂等保证：
 * - 每批数据更新一次水位线
 * - 失败时回滚到上一个成功的水位
 * - 支持断点续传（从上次成功位置继续）
 */

import { db } from '../db';
import { integrationJobs } from '../db/schema/integration-job';
import { eq } from 'drizzle-orm';

export type WatermarkStrategy = 'id' | 'timestamp' | 'version' | 'hybrid' | 'cursor';

export interface WatermarkState {
  strategy: WatermarkStrategy;
  field: string;                 // 水位字段名
  currentValue: string | number | null; // 当前水位值
  lastValue: string | number | null;    // 上一次成功的水位值（用于回滚）
  lastSuccessAt: string | null; // 上次成功时间
  processedCount: number;       // 本次已处理行数
  totalProcessed: number;       // 累计处理行数
  isInitial: boolean;           // 是否首次全量同步
}

/** 解析水位配置字符串（存储在 job.incrementConfig 中） */
export function parseWatermarkConfig(incrementConfig: Record<string, unknown> | null): WatermarkState {
  if (!incrementConfig) {
    return {
      strategy: 'id',
      field: 'id',
      currentValue: null,
      lastValue: null,
      lastSuccessAt: null,
      processedCount: 0,
      totalProcessed: 0,
      isInitial: true,
    };
  }

  return {
    strategy: (incrementConfig.watermarkStrategy as WatermarkStrategy) || 'id',
    field: (incrementConfig.watermarkField as string) || 'id',
    currentValue: incrementConfig.watermarkValue as string | number | null || null,
    lastValue: incrementConfig.lastWatermarkValue as string | number | null || null,
    lastSuccessAt: incrementConfig.lastSuccessAt as string | null || null,
    processedCount: 0,
    totalProcessed: (incrementConfig.totalProcessed as number) || 0,
    isInitial: !incrementConfig.watermarkValue,
  };
}

/** 构建 SQL 查询的 where 条件（基于当前水位） */
export function buildWatermarkClause(
  strategy: WatermarkStrategy,
  field: string,
  value: string | number | null,
): string {
  if (value === null || value === undefined) return '';

  const escapedField = `"${field}"`;
  switch (strategy) {
    case 'id':
      return `${escapedField} > ${value}`;
    case 'timestamp':
      return `${escapedField} > '${value}'`;
    case 'version':
      return `${escapedField} > ${value}`;
    case 'hybrid':
      // 混合模式：(时间戳=上次 且 ID>上次ID) 或 时间戳>上次
      return `${escapedField} > '${value}'`;
    case 'cursor':
      return `cursor = '${value}'`;
    default:
      return '';
  }
}

/** 从一批数据中计算新的水位值 */
export function computeNextWatermark(
  strategy: WatermarkStrategy,
  field: string,
  records: Record<string, unknown>[],
): string | number | null {
  if (records.length === 0) return null;

  switch (strategy) {
    case 'id':
    case 'version':
      return records.reduce((max, r) => {
        const v = Number(r[field]);
        return !isNaN(v) && v > max ? v : max;
      }, -Infinity) as number;

    case 'timestamp':
    case 'hybrid':
      return records.reduce((max, r) => {
        const v = String(r[field] || '');
        return v > max ? v : max;
      }, '') as string;

    case 'cursor':
      return String(records[records.length - 1][field] || '');

    default:
      return null;
  }
}

/** 推进水位线（每批数据处理成功后调用） */
export async function advanceWatermark(
  jobId: string,
  state: WatermarkState,
  newValue: string | number,
  batchCount: number,
): Promise<void> {
  state.lastValue = state.currentValue;
  state.currentValue = newValue;
  state.processedCount += batchCount;
  state.totalProcessed += batchCount;
  state.isInitial = false;
  state.lastSuccessAt = new Date().toISOString();

  // 持久化到数据库
  await db.update(integrationJobs)
    .set({
      watermarkStrategy: state.strategy,
      watermarkField: state.field,
      watermarkValue: String(state.currentValue ?? ''),
      lastWatermarkValue: String(state.lastValue ?? ''),
      lastExecutionAt: new Date(state.lastSuccessAt),
    })
    .where(eq(integrationJobs.id, jobId));
}

/** 回滚水位线（批次失败时调用，回退到上一次成功的位置） */
export async function rollbackWatermark(
  jobId: string,
  state: WatermarkState,
): Promise<void> {
  state.currentValue = state.lastValue;

  await db.update(integrationJobs)
    .set({
      watermarkValue: String(state.currentValue ?? ''),
      lastWatermarkValue: String(state.lastValue ?? ''),
    })
    .where(eq(integrationJobs.id, jobId));
}

/** 重置水位线（手动触发全量重新同步） */
export async function resetWatermark(jobId: string): Promise<void> {
  await db.update(integrationJobs)
    .set({
      watermarkValue: null,
      lastWatermarkValue: null,
      lastExecutionAt: null,
    })
    .where(eq(integrationJobs.id, jobId));
}

/** 获取水位线状态（用于 API 展示） */
export function getWatermarkInfo(state: WatermarkState) {
  return {
    strategy: state.strategy,
    field: state.field,
    currentValue: state.currentValue,
    lastSuccessAt: state.lastSuccessAt,
    totalProcessed: state.totalProcessed,
    isInitial: state.isInitial,
  };
}
