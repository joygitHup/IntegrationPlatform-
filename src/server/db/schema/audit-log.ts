import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// 审计日志表
// ============================================================
export const auditLogs = sqliteTable(
  'sys_audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id', { length: 32 }),
    username: text('username', { length: 64 }),

    // 操作类型
    action: text('action', { length: 32 }).notNull(),
    // LOGIN / LOGOUT / CREATE / UPDATE / DELETE / EXECUTE / APPROVE

    // 资源类型
    resourceType: text('resource_type', { length: 64 }),
    // JOB / DATASOURCE / USER / APP / ROLE / SETTING

    resourceId: text('resource_id', { length: 64 }),
    resourceName: text('resource_name', { length: 256 }),

    // 操作详情（变更前后对比、操作参数等）
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),

    // 来源 IP
    ip: text('ip', { length: 64 }),
    userAgent: text('user_agent', { length: 512 }),

    // 请求追踪 ID
    traceId: text('trace_id', { length: 64 }),

    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxUserId: index('idx_audit_user_id').on(table.userId),
    idxResource: index('idx_audit_resource').on(table.resourceType, table.resourceId),
    idxAction: index('idx_audit_action').on(table.action),
    idxCreatedAt: index('idx_audit_created_at').on(table.createdAt),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
