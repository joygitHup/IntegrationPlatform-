import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// 用户表
// ============================================================
export const users = sqliteTable(
  'sys_users',
  {
    id: text('id').primaryKey(),
    username: text('username', { length: 64 }).notNull().unique(),
    email: text('email', { length: 128 }).unique(),
    passwordHash: text('password_hash', { length: 255 }).notNull(),
    displayName: text('display_name', { length: 64 }),
    roleId: text('role_id', { length: 32 }),
    status: text('status', { length: 16 }).notNull().default('active'), // active / disabled / locked
    lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
    loginFailCount: integer('login_fail_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxUsername: index('idx_users_username').on(table.username),
    idxRole: index('idx_users_role').on(table.roleId),
  }),
);

// ============================================================
// 角色表
// ============================================================
export const roles = sqliteTable(
  'sys_roles',
  {
    id: text('id').primaryKey(),
    code: text('code', { length: 32 }).notNull().unique(),
    name: text('name', { length: 64 }).notNull().unique(),
    description: text('description', { length: 255 }),
    status: text('status', { length: 16 }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxRoleCode: index('idx_roles_code').on(table.code),
  }),
);

// ============================================================
// 角色权限表
// ============================================================
export const rolePermissions = sqliteTable(
  'sys_role_permissions',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id', { length: 32 }).notNull(),
    permission: text('permission', { length: 64 }).notNull(),
    resource: text('resource', { length: 128 }).notNull().default('*'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxRolePerm: index('idx_role_permissions_role').on(table.roleId),
    uniqRolePerm: index('idx_role_permissions_uniq').on(table.roleId, table.permission, table.resource),
  }),
);

// ============================================================
// 接入应用表（OAuth2 客户端）
// ============================================================
export const apps = sqliteTable(
  'sys_apps',
  {
    id: text('id').primaryKey(),
    name: text('name', { length: 64 }).notNull(),
    appKey: text('app_key', { length: 64 }).notNull().unique(),
    appSecretEncrypted: text('app_secret_encrypted', { length: 512 }).notNull(),
    description: text('description', { length: 255 }),
    status: text('status', { length: 16 }).notNull().default('active'),
    createdBy: text('created_by', { length: 32 }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().defaultNow(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().defaultNow(),
  },
  (table) => ({
    idxAppKey: index('idx_apps_app_key').on(table.appKey),
  }),
);

// ============================================================
// 类型定义
// ============================================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
