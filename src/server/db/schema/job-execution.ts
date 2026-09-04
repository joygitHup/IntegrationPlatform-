import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// 任务执行历史表
// ============================================================
export const jobExecutions = sqliteTable(
  'job_execution',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id', { length: 32 }).notNull(),
    // 触发方式
    triggerType: text('trigger_type', { length: 16 }).notNull(), // manual / schedule / webhook / retry
    triggeredBy: text('triggered_by', { length: 32 }), // 手动触发的用户ID

    // 执行状态
    status: text('status', { length: 16 }).notNull().default('pending'),
    // pending / running / success / failed / cancelled / partial_failed

    // 时间
    startedAt: integer('started_at', { mode: 'timestamp' }),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    durationMs: integer('duration_ms'), // 执行耗时（毫秒）

    // 统计
    totalRows: integer('total_rows').default(0), // 总行数
    successRows: integer('success_rows').default(0), // 成功行数
    failedRows: integer('failed_rows').default(0), // 失败行数
    skippedRows: integer('skipped_rows').default(0), // 跳过行数

    // 执行开始时的水位值
    startWatermark: text('start_watermark', { length: 128 }),
    // 执行结束后的水位值
    endWatermark: text('end_watermark', { length: 128 }),

    // 错误信息
    errorMessage: text('error_message', { length: 2000 }),
    errorStack: text('error_stack', { length: 4000 }),

    // 重试次数（本次执行内）
    retryAttempts: integer('retry_attempts').default(0),

    // 关联的 BullMQ job ID
    queueJobId: text('queue_job_id', { length: 64 }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxJobId: index('idx_exec_job_id').on(table.jobId),
    idxStatus: index('idx_exec_status').on(table.status),
    idxCreatedAt: index('idx_exec_created_at').on(table.createdAt),
    idxJobCreated: index('idx_exec_job_created').on(table.jobId, table.createdAt),
  }),
);

// ============================================================
// 死信队列表
// ============================================================
export const deadLetterMessages = sqliteTable(
  'dead_letter_message',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id', { length: 32 }).notNull(),
    executionId: text('execution_id', { length: 32 }).notNull(),

    // 原始数据（JSON，已脱敏）
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    // 是否已脱敏
    isDesensitized: integer('is_desensitized', { mode: 'boolean' }).notNull().default(false),
    // 原始 payload 哈希（用于去重和追溯，不存明文）
    payloadHash: text('payload_hash', { length: 64 }),

    // 错误信息
    errorMessage: text('error_message', { length: 2000 }),
    errorType: text('error_type', { length: 64 }),

    // 重试次数
    retryCount: integer('retry_count').notNull().default(0),
    // 状态
    status: text('status', { length: 16 }).notNull().default('pending'), // pending / reprocessed / ignored
    // 最后处理时间
    processedAt: integer('processed_at', { mode: 'timestamp' }),
    processedBy: text('processed_by', { length: 32 }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxJobId: index('idx_dlq_job_id').on(table.jobId),
    idxExecutionId: index('idx_dlq_exec_id').on(table.executionId),
    idxStatus: index('idx_dlq_status').on(table.status),
  }),
);

// ============================================================
// 类型定义
// ============================================================
export type JobExecution = typeof jobExecutions.$inferSelect;
export type NewJobExecution = typeof jobExecutions.$inferInsert;
export type DeadLetterMessage = typeof deadLetterMessages.$inferSelect;
export type NewDeadLetterMessage = typeof deadLetterMessages.$inferInsert;

// ============================================================
// 字段级变更审计表
// ============================================================
export const fieldChangeAudits = sqliteTable(
  'field_change_audit',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id', { length: 32 }).notNull(),
    executionId: text('execution_id', { length: 32 }).notNull(),

    // 匹配键值（唯一标识某条记录）
    recordKey: text('record_key', { length: 256 }).notNull(),
    // 操作类型：create / update / delete / skip_conflict
    operation: text('operation', { length: 16 }).notNull(),

    // 变更字段列表（JSON：[{ field, oldValue, newValue }]）
    changes: text('changes', { mode: 'json' }).$type<FieldChange[]>().notNull().default([]),

    // 变更前后数据快照的哈希（不存明文）
    beforeHash: text('before_hash', { length: 64 }),
    afterHash: text('after_hash', { length: 64 }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxJobId: index('idx_fca_job_id').on(table.jobId),
    idxExecutionId: index('idx_fca_exec_id').on(table.executionId),
    idxRecordKey: index('idx_fca_record_key').on(table.recordKey),
    idxOperation: index('idx_fca_operation').on(table.operation),
  }),
);

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export type FieldChangeAudit = typeof fieldChangeAudits.$inferSelect;
export type NewFieldChangeAudit = typeof fieldChangeAudits.$inferInsert;

// ============================================================
// 数据版本快照表（回滚用）
// ============================================================
export const dataVersionSnapshots = sqliteTable(
  'data_version_snapshot',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id', { length: 32 }).notNull(),
    executionId: text('execution_id', { length: 32 }).notNull(),

    // 版本号
    version: integer('version').notNull().default(1),
    // 快照类型：before / after
    snapshotType: text('snapshot_type', { length: 8 }).notNull(), // before / after

    // 记录总数
    recordCount: integer('record_count').notNull().default(0),
    // 快照数据存储路径（大数据量存文件，小数据量直接存数据库）
    // 对于 SQLite 开发环境，直接存 JSON
    snapshotData: text('snapshot_data', { mode: 'json' }).$type<Record<string, unknown>[]>().notNull().default([]),

    // 过期时间（TTL）
    expiresAt: integer('expires_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxJobVersion: index('idx_dvs_job_version').on(table.jobId, table.version),
    idxExecutionId: index('idx_dvs_exec_id').on(table.executionId),
    idxExpiresAt: index('idx_dvs_expires_at').on(table.expiresAt),
  }),
);

export type DataVersionSnapshot = typeof dataVersionSnapshots.$inferSelect;
export type NewDataVersionSnapshot = typeof dataVersionSnapshots.$inferInsert;
