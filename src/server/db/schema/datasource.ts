import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// 数据源表
// ============================================================
export const datasources = sqliteTable(
  'datasource',
  {
    id: text('id').primaryKey(),
    name: text('name', { length: 128 }).notNull(),
    code: text('code', { length: 64 }).notNull().unique(),
    // 数据源类型：mysql / postgres / http_api / rabbitmq / kafka / redis
    type: text('type', { length: 32 }).notNull(),
    // 连接配置 JSON（敏感字段加密后存储）
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    description: text('description', { length: 255 }),
    status: text('status', { length: 16 }).notNull().default('active'), // active / disabled
    // 最后一次连通性测试结果
    lastTestStatus: text('last_test_status', { length: 16 }), // success / failed
    lastTestAt: integer('last_test_at', { mode: 'timestamp' }),
    lastTestError: text('last_test_error', { length: 512 }),
    createdBy: text('created_by', { length: 32 }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxType: index('idx_ds_type').on(table.type),
    idxCode: index('idx_ds_code').on(table.code),
  }),
);

// ============================================================
// 类型定义
// ============================================================
export type Datasource = typeof datasources.$inferSelect;
export type NewDatasource = typeof datasources.$inferInsert;

// 数据源配置类型
export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string; // 加密存储
}

export interface HttpApiConfig {
  baseUrl: string;
  authType: 'none' | 'bearer' | 'basic' | 'apikey';
  token?: string; // 加密存储
  apiKeyHeader?: string;
  apiKeyValue?: string; // 加密存储
  timeoutMs?: number;
}

export interface MQConfig {
  host: string;
  port: number;
  username?: string;
  password?: string; // 加密存储
  vhost?: string;
  exchange?: string;
  queue?: string;
}
