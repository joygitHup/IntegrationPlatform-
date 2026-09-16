/** 与 backend/core/permissions.py 对齐，供登录后侧边栏/按钮鉴权。 */
const PERM_ALIASES: Record<string, string[]> = {
  'dlq:read': ['deadletter:read'],
  'dlq:reprocess': ['deadletter:retry', 'deadletter:delete'],
  'deadletter:read': ['dlq:read'],
  'deadletter:retry': ['dlq:reprocess'],
  'deadletter:delete': ['dlq:reprocess'],
  'app:write': ['application:write'],
  'app:delete': ['application:delete'],
  'application:write': ['app:write'],
  'application:delete': ['app:delete'],
  'user:delete': ['user:write'],
  'open:manage': ['system:write'],
};

export function hasPermission(
  user: { permissions?: string[]; roleCode?: string } | null | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  if (user.roleCode === 'admin') return true;
  const perms = user.permissions || [];
  if (perms.includes('*') || perms.includes(permission)) return true;
  for (const alias of PERM_ALIASES[permission] || []) {
    if (perms.includes(alias)) return true;
  }
  for (const p of perms) {
    if (p === permission || p.startsWith(`${permission}:`)) return true;
    const [left, right] = p.split(':');
    const [reqLeft, reqRight] = permission.split(':');
    if (left === reqLeft && (right === '*' || right === reqRight || !reqRight)) return true;
    const parts = p.split(':');
    if (parts.length >= 2 && `${parts[0]}:${parts[1]}` === permission) return true;
  }
  return false;
}

export function safeRedirectPath(from: string | null | undefined): string {
  if (!from || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/login')) {
    return '/';
  }
  return from;
}
