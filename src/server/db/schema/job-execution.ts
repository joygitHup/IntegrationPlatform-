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

    // 原始数据（JSON）
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),

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
