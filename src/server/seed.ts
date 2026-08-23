import { db } from './db';
import { users, roles, rolePermissions, applications } from './db/schema';
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
      'app:read', 'app:write', 'app:delete',
      'sso:audit', 'sso:manage',
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
        'app:read',
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

    // 5. 创建示例应用（SSO 单点登录）
    const sampleApps = [
      {
        name: '企业邮箱',
        code: 'email',
        description: '企业邮箱系统单点登录',
        icon: '📧',
        category: 'business',
        loginType: 'jwt',
        loginUrl: 'https://mail.example.com/sso/login',
        logoutUrl: 'https://mail.example.com/logout',
        sortOrder: 1,
      },
      {
        name: 'OA 办公系统',
        code: 'oa',
        description: '企业 OA 协同办公平台',
        icon: '💼',
        category: 'business',
        loginType: 'ticket',
        loginUrl: 'https://oa.example.com/sso/ticket',
        sortOrder: 2,
      },
      {
        name: 'CRM 客户管理',
        code: 'crm',
        description: '客户关系管理系统',
        icon: '👥',
        category: 'business',
        loginType: 'oauth2',
        loginUrl: 'https://crm.example.com/oauth/authorize',
        oauthClientId: 'integration-platform',
        oauthAuthUrl: 'https://crm.example.com/oauth/authorize',
        oauthTokenUrl: 'https://crm.example.com/oauth/token',
        oauthUserInfoUrl: 'https://crm.example.com/api/userinfo',
        sortOrder: 3,
      },
      {
        name: '数据报表平台',
        code: 'bi',
        description: 'BI 数据可视化报表',
        icon: '📊',
        category: 'data',
        loginType: 'jwt',
        loginUrl: 'https://bi.example.com/api/sso/jwt',
        sortOrder: 10,
      },
      {
        name: '文档知识库',
        code: 'wiki',
        description: '企业文档与知识管理',
        icon: '📚',
        category: 'business',
        loginType: 'ticket',
        loginUrl: 'https://wiki.example.com/sso',
        sortOrder: 4,
      },
      {
        name: '代码仓库',
        code: 'gitlab',
        description: 'GitLab 代码托管平台',
        icon: '🔧',
        category: 'devops',
        loginType: 'oauth2',
        loginUrl: 'https://gitlab.example.com/oauth/authorize',
        oauthClientId: 'integration-platform',
        oauthAuthUrl: 'https://gitlab.example.com/oauth/authorize',
        oauthTokenUrl: 'https://gitlab.example.com/oauth/token',
        oauthUserInfoUrl: 'https://gitlab.example.com/api/v4/user',
        sortOrder: 20,
      },
    ];

    const appValues = sampleApps.map(app => ({
      id: generateId('app'),
      ...app,
      secretKey: 'sso-demo-secret-key-please-change-in-production',
      status: 'active' as const,
      createdBy: adminUserId,
    }));

    await db.insert(applications).values(appValues);
    console.log(`[Seed] 已创建 ${sampleApps.length} 个示例应用`);
    console.log('[Seed] 默认管理员账号: admin / admin123');
    console.log('[Seed] 请登录后立即修改默认密码!');

    return { seeded: true, message: '系统初始化成功' };
  } catch (error) {
    console.error('[Seed] 初始化失败:', error);
    throw error;
  }
}
