import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/server/utils/jwt';
import { getDb } from '@/server/db';
import { users, roles, rolePermissions } from '@/server/db/schema/iam';
import { eq } from 'drizzle-orm';

export interface AuthContext {
  userId: string;
  username: string;
  roleId: string;
  roleCode: string;
  permissions: string[];
  ip: string;
  userAgent: string;
  traceId: string;
}

function generateTraceIdInline(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * 从请求头中提取 token
 */
export function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const tokenCookie = request.cookies.get('access_token');
  if (tokenCookie) return tokenCookie.value;
  return null;
}

/**
 * 认证中间件 - 验证用户身份
 */
export async function authenticate(request: NextRequest): Promise<AuthContext | null> {
  const token = extractToken(request);
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload || payload.type !== 'access') return null;

  const db = getDb();
  const userList = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
  if (userList.length === 0) return null;

  const user = userList[0];
  if (user.status !== 'active') return null;

  // 获取角色信息
  let roleCode = '';
  let permissions: string[] = [];

  if (user.roleId) {
    const roleList = await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1);
    if (roleList.length > 0) {
      roleCode = roleList[0].code;
      // admin 角色直接给全部权限
      if (roleList[0].code === 'admin') {
        permissions = ['*'];
      } else {
        const perms = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, user.roleId));
        permissions = perms.map((p) => `${p.permission}:${p.resource}`);
      }
    }
  }

  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  const userAgent = request.headers.get('user-agent') || '';
  const traceId = request.headers.get('x-trace-id') || generateTraceIdInline();

  return {
    userId: user.id,
    username: user.username,
    roleId: user.roleId || '',
    roleCode,
    permissions,
    ip,
    userAgent,
    traceId,
  };
}

/**
 * 权限校验 - 检查用户是否拥有指定权限
 */
export function hasPermission(auth: AuthContext, permission: string): boolean {
  // admin 拥有所有权限
  if (auth.roleCode === 'admin') return true;
  if (auth.permissions.includes('*')) return true;
  if (auth.permissions.includes(`${permission}:*`)) return true;

  // 精确匹配或通配符匹配
  for (const perm of auth.permissions) {
    if (perm === permission) return true;
    // datasource:* 匹配 datasource:read, datasource:write
    const [permAction, permResource] = perm.split(':');
    const [reqAction, reqResource] = permission.split(':');
    if (permAction === reqAction && (permResource === '*' || permResource === reqResource)) {
      return true;
    }
  }
  return false;
}

/**
 * 权限校验装饰器 - 用于 API 路由
 */
export function requirePermission(permission: string) {
  return async (request: NextRequest): Promise<AuthContext | Response> => {
    const auth = await authenticate(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasPermission(auth, permission)) {
      return NextResponse.json({ error: 'Forbidden', message: '权限不足' }, { status: 403 });
    }
    return auth;
  };
}
