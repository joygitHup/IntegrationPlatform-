import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// 部门/组织架构表
// ============================================================
export const departments = sqliteTable(
  'department',
  {
    id: text('id').primaryKey(),
    // 所属集成任务 ID（组织架构同步关联的任务）
    jobId: text('job_id', { length: 32 }).notNull(),
    // 源系统部门唯一标识（用于匹配）
    sourceId: text('source_id', { length: 128 }).notNull(),

    // 部门编码
    code: text('code', { length: 64 }).notNull(),
    // 部门名称
    name: text('name', { length: 128 }).notNull(),
    // 部门全称
    fullName: text('full_name', { length: 256 }),

    // 父部门 sourceId（顶层为 null）
    parentSourceId: text('parent_source_id', { length: 128 }),
    // 层级路径，如 /root/tech/backend
    path: text('path', { length: 512 }),
    // 层级深度（从 0 开始）
    depth: integer('depth').notNull().default(0),

    // 部门排序
    sortOrder: integer('sort_order').notNull().default(0),
    // 部门负责人
    manager: text('manager', { length: 64 }),

    // 状态：active / inactive
    status: text('status', { length: 16 }).notNull().default('active'),

    // 扩展属性
    attributes: text('attributes', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),

    // 数据来源：source（从源同步） / manual（手动创建）
    dataSource: text('data_source', { length: 16 }).notNull().default('source'),
    // 源系统更新时间（用于增量同步判断）
    sourceUpdatedAt: integer('source_updated_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxJobId: index('idx_dept_job_id').on(table.jobId),
    idxSourceId: index('idx_dept_source_id').on(table.jobId, table.sourceId),
    idxParent: index('idx_dept_parent').on(table.jobId, table.parentSourceId),
    idxCode: index('idx_dept_code').on(table.jobId, table.code),
    idxStatus: index('idx_dept_status').on(table.status),
  }),
);

// ============================================================
// 用户-部门关联表
// ============================================================
export const userDepartments = sqliteTable(
  'user_department',
  {
    id: text('id').primaryKey(),
    // 所属集成任务 ID
    jobId: text('job_id', { length: 32 }).notNull(),
    // 用户源 ID（与源系统用户标识对应）
    userSourceId: text('user_source_id', { length: 128 }).notNull(),
    // 部门源 ID
    deptSourceId: text('dept_source_id', { length: 128 }).notNull(),

    // 是否主部门
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(true),
    // 用户在部门中的职位
    position: text('position', { length: 64 }),
    // 入职部门时间
    joinedAt: integer('joined_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxJobId: index('idx_udept_job_id').on(table.jobId),
    idxUserDept: index('idx_udept_user_dept').on(table.jobId, table.userSourceId, table.deptSourceId),
    idxDept: index('idx_udept_dept').on(table.jobId, table.deptSourceId),
  }),
);

// ============================================================
// 组织架构同步执行记录表
// ============================================================
export const deptSyncExecutions = sqliteTable(
  'dept_sync_execution',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id', { length: 32 }).notNull(),
    executionId: text('execution_id', { length: 32 }).notNull(),

    // 同步阶段：dept（部门树）/ user_dept（用户部门关系）
    phase: text('phase', { length: 16 }).notNull(),

    // 统计
    totalCount: integer('total_count').default(0),
    createdCount: integer('created_count').default(0),
    updatedCount: integer('updated_count').default(0),
    deletedCount: integer('deleted_count').default(0),
    failedCount: integer('failed_count').default(0),
    skippedCount: integer('skipped_count').default(0),

    // 错误汇总
    errorSummary: text('error_summary', { length: 2000 }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxJobId: index('idx_dse_job_id').on(table.jobId),
    idxExecutionId: index('idx_dse_exec_id').on(table.executionId),
  }),
);

// ============================================================
// 类型定义
// ============================================================
export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type UserDepartment = typeof userDepartments.$inferSelect;
export type NewUserDepartment = typeof userDepartments.$inferInsert;
export type DeptSyncExecution = typeof deptSyncExecutions.$inferSelect;
export type NewDeptSyncExecution = typeof deptSyncExecutions.$inferInsert;
