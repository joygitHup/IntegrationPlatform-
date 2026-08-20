import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// 集成任务表
// ============================================================
export const integrationJobs = sqliteTable(
  'integration_job',
  {
    id: text('id').primaryKey(),
    name: text('name', { length: 128 }).notNull(),
    code: text('code', { length: 64 }).notNull().unique(),
    description: text('description', { length: 255 }),

    // 源 & 目标数据源
    sourceDatasourceId: text('source_datasource_id', { length: 32 }).notNull(),
    targetDatasourceId: text('target_datasource_id', { length: 32 }).notNull(),

    // 源配置：表名 / API 路径 / 队列名
    sourceConfig: text('source_config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    // 目标配置
    targetConfig: text('target_config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),

    // 字段映射规则 JSON
    // [{ source: "user_name", target: "username", transform: "trim" }, ...]
    fieldMapping: text('field_mapping', { mode: 'json' }).$type<FieldMappingRule[]>().notNull().default([]),

    // 过滤条件 SQL / 表达式
    filterCondition: text('filter_condition', { length: 1024 }),

    // 同步模式
    syncMode: text('sync_mode', { length: 16 }).notNull().default('full'), // full / incremental
    // 增量同步策略
    watermarkStrategy: text('watermark_strategy', { length: 16 }).default('timestamp'), // id / timestamp / version
    // 增量同步水位字段
    watermarkField: text('watermark_field', { length: 64 }),
    // 当前水位值
    watermarkValue: text('watermark_value', { length: 128 }),
    // 上一次水位值（断点回退用）
    lastWatermarkValue: text('last_watermark_value', { length: 128 }),
    // 最后执行时间
    lastExecutionAt: integer('last_execution_at', { mode: 'timestamp' }),

    // 调度配置
    scheduleType: text('schedule_type', { length: 16 }).notNull().default('cron'), // manual / cron / event / webhook
    scheduleCron: text('schedule_cron', { length: 64 }), // e.g. "0 */5 * * * *"
    // 批次大小
    batchSize: integer('batch_size').notNull().default(1000),
    // 并发数
    concurrency: integer('concurrency').notNull().default(1),
    // 失败重试次数
    retryCount: integer('retry_count').notNull().default(3),
    // 失败重试间隔(秒)
    retryInterval: integer('retry_interval').notNull().default(60),

    // 任务状态
    status: text('status', { length: 16 }).notNull().default('stopped'), // running / stopped / paused / error

    // 版本号（乐观锁 & 审计）
    version: integer('version').notNull().default(1),

    createdBy: text('created_by', { length: 32 }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxStatus: index('idx_job_status').on(table.status),
    idxSchedule: index('idx_job_schedule').on(table.scheduleType, table.status),
    idxSource: index('idx_job_source').on(table.sourceDatasourceId),
    idxTarget: index('idx_job_target').on(table.targetDatasourceId),
  }),
);

// ============================================================
// 字段映射规则类型
// ============================================================
export interface FieldMappingRule {
  source: string;
  target: string;
  transform?: FieldTransform;
  // 转换函数参数
  params?: Record<string, unknown>;
  // 是否为必填
  required?: boolean;
  // 默认值
  defaultValue?: unknown;
}

export type FieldTransform =
  | 'none'
  | 'trim'
  | 'upper'
  | 'lower'
  | 'to_number'
  | 'to_string'
  | 'to_date'
  | 'concat'
  | 'substring'
  | 'replace'
  | 'md5'
  | 'base64_encode'
  | 'base64_decode'
  | 'custom'; // 自定义 JS 表达式

// ============================================================
// 类型定义
// ============================================================
export type IntegrationJob = typeof integrationJobs.$inferSelect;
export type NewIntegrationJob = typeof integrationJobs.$inferInsert;
