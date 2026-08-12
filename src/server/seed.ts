import { db } from './db';
import { users, roles, rolePermissions } from './db/schema';
import { hashPassword } from './utils/password';
import { generateId } from './utils/id';
import { eq } from 'drizzle-orm';

/**
 * 系统初始化种子数据
 * - 创建默认角色
 * - 创建默认管理员账户
 */
export async function seedSystem() {
  try {
    // 1. 检查是否已有管理员
    const existingAdmin = await db.select().from(users).where(eq(users.username, 'admin')).limit(1);

    if (existingAdmin.length > 0) {
      return { seeded: false, message: '系统已初始化' };
    }

    // 2. 创建角色
    const adminRoleId = generateId();
    const developerRoleId = generateId();
    const operatorRoleId = generateId();
    const viewerRoleId = generateId();

    await db.insert(roles).values([
      {
        id: adminRoleId,
        code: 'admin',
        name: '超级管理员',
        description: '拥有系统所有权限',
        status: 'active',
      },
      {
        id: developerRoleId,
        code: 'developer',
        name: '开发者',
        description: '可管理数据源和任务配置',
        status: 'active',
      },
      {
        id: operatorRoleId,
        code: 'operator',
        name: '运维人员',
        description: '可查看监控、处理死信、执行任务',
        status: 'active',
      },
      {
        id: viewerRoleId,
        code: 'viewer',
        name: '只读用户',
        description: '仅可查看数据',
        status: 'active',
      },
    ]);

    // 3. 创建权限
    const allPermissions = [
      'user:read', 'user:write', 'user:delete',
      'role:read', 'role:write',
      'datasource:read', 'datasource:write', 'datasource:delete',
      'job:read', 'job:write', 'job:execute', 'job:delete',
      'execution:read', 'execution:retry',
      'deadletter:read', 'deadletter:retry', 'deadletter:delete',
      'audit:read',
      'system:read', 'system:write',
    ];

    const buildPermissions = (roleId: string, perms: string[]) =>
      perms.map(p => ({
        id: generateId(),
        roleId,
        permission: p,
        resource: '*',
      }));

    await db.insert(rolePermissions).values([
      ...buildPermissions(adminRoleId, allPermissions),
      ...buildPermissions(developerRoleId, [
        'datasource:read', 'datasource:write',
        'job:read', 'job:write', 'job:execute',
        'execution:read', 'execution:retry',
        'deadletter:read', 'deadletter:retry',
        'audit:read',
      ]),
      ...buildPermissions(operatorRoleId, [
        'datasource:read',
        'job:read', 'job:execute',
        'execution:read', 'execution:retry',
        'deadletter:read', 'deadletter:retry', 'deadletter:delete',
        'audit:read',
      ]),
      ...buildPermissions(viewerRoleId, [
        'datasource:read',
        'job:read',
        'execution:read',
        'deadletter:read',
        'audit:read',
      ]),
    ]);

    // 4. 创建默认管理员
    const hashedPwd = await hashPassword('admin123');
    const adminUserId = generateId();

    await db.insert(users).values({
      id: adminUserId,
      username: 'admin',
      email: 'admin@integration.local',
      displayName: '超级管理员',
      passwordHash: hashedPwd,
      roleId: adminRoleId,
      status: 'active',
    });

    console.log('[Seed] 系统初始化完成');
    console.log('[Seed] 默认管理员账号: admin / admin123');
    console.log('[Seed] 请登录后立即修改默认密码!');

    return { seeded: true, message: '系统初始化成功' };
  } catch (error) {
    console.error('[Seed] 初始化失败:', error);
    throw error;
  }
}
