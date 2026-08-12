import { getDb } from '@/server/db';
import { users, roles, rolePermissions, type NewUser } from '@/server/db/schema/iam';
import { generateId } from '@/server/utils/id';
import { hashPassword, verifyPassword } from '@/server/utils/password';
import { eq, like, inArray } from 'drizzle-orm';
import { seedSystem } from '@/server/seed';

// ============================================================
// 初始化默认数据
// ============================================================
export async function seedDefaultData() {
  await seedSystem();
}

// ============================================================
// 用户服务
// ============================================================
export async function getUserByUsername(username: string) {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result[0] || null;
}

export async function getUserById(id: string) {
  const db = getDb();
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] || null;
}

export interface UserWithRole extends Omit<Awaited<ReturnType<typeof getUserById>>, 'passwordHash'> {
  roleCode?: string;
  roleName?: string;
}

export async function getUserWithRole(id: string): Promise<UserWithRole | null> {
  const db = getDb();
  const user = await getUserById(id);
  if (!user) return null;

  let roleCode: string | undefined;
  let roleName: string | undefined;

  if (user.roleId) {
    const roleResult = await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1);
    if (roleResult[0]) {
      roleCode = roleResult[0].code;
      roleName = roleResult[0].name;
    }
  }

  const { passwordHash, ...safeUser } = user;
  return { ...safeUser, roleCode, roleName };
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  const db = getDb();
  const user = await getUserById(userId);
  if (!user || !user.roleId) return [];

  const perms = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, user.roleId));
  return perms.map((p) => `${p.permission}:${p.resource}`);
}

export async function hasPermission(userId: string, permission: string): Promise<boolean> {
  const db = getDb();
  const user = await getUserById(userId);
  if (!user || !user.roleId) return false;

  // 先检查角色状态
  const roleResult = await db.select().from(roles).where(eq(roles.id, user.roleId)).limit(1);
  if (!roleResult[0] || roleResult[0].status !== 'active') return false;

  // 检查 admin 角色（所有权限）
  if (roleResult[0].code === 'admin') return true;

  // 匹配权限: permission 格式如 "datasource:write"
  const [action] = permission.split(':');
  const perms = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, user.roleId));

  return perms.some((p) => {
    if (p.permission === '*') return true;
    if (p.permission === permission) return true;
    // 支持 datasource:* 匹配 datasource:read, datasource:write 等
    const [pAction, pResource] = p.permission.split(':');
    const [reqAction, reqResource] = permission.split(':');
    if (pAction === reqAction && (pResource === '*' || pResource === reqResource)) return true;
    return false;
  });
}

export async function listUsers(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  roleId?: string;
  status?: string;
}) {
  const db = getDb();
  const page = params.page || 1;
  const pageSize = params.pageSize || 20;
  const offset = (page - 1) * pageSize;

  let query = db.select().from(users).$dynamic();

  const all = await db.select().from(users).orderBy(users.createdAt);
  let filtered = [...all].reverse();
  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    filtered = filtered.filter(
      (u) => u.username.toLowerCase().includes(kw) || u.displayName?.toLowerCase().includes(kw) || u.email?.toLowerCase().includes(kw),
    );
  }
  if (params.roleId) filtered = filtered.filter((u) => u.roleId === params.roleId);
  if (params.status) filtered = filtered.filter((u) => u.status === params.status);

  // 附加角色信息
  const roleIds = [...new Set(filtered.map((u) => u.roleId).filter(Boolean))];
  const roleMap = new Map<string, { code: string; name: string }>();
  if (roleIds.length > 0) {
    const roleList = await db.select().from(roles).where(inArray(roles.id, roleIds as string[]));
    roleList.forEach((r) => roleMap.set(r.id, { code: r.code, name: r.name }));
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + pageSize).map(({ passwordHash, ...rest }) => {
    const role = rest.roleId ? roleMap.get(rest.roleId) : undefined;
    return { ...rest, roleCode: role?.code, roleName: role?.name };
  });

  return { items, total, page, pageSize };
}

export async function createUser(input: {
  username: string;
  email?: string;
  displayName?: string;
  password: string;
  roleId: string;
}) {
  const db = getDb();
  const existing = await getUserByUsername(input.username);
  if (existing) {
    throw new Error('用户名已存在');
  }

  const passwordHash = await hashPassword(input.password);
  const user: NewUser = {
    id: generateId(),
    username: input.username,
    email: input.email,
    displayName: input.displayName,
    passwordHash,
    roleId: input.roleId,
    status: 'active',
  };

  await db.insert(users).values(user);
  const { passwordHash: _hash, ...safeUser } = user;
  return safeUser;
}

export async function updateUser(id: string, input: {
  email?: string;
  displayName?: string;
  roleId?: string;
  status?: string;
  password?: string;
}) {
  const db = getDb();
  const updateData: Record<string, unknown> = { ...input };
  if (input.password) {
    updateData.passwordHash = await hashPassword(input.password);
    delete updateData.password;
  }
  updateData.updatedAt = new Date();

  await db.update(users).set(updateData).where(eq(users.id, id));
  const user = await getUserById(id);
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

export async function deleteUser(id: string) {
  const db = getDb();
  await db.delete(users).where(eq(users.id, id));
}

export async function updateLastLogin(id: string) {
  const db = getDb();
  await db.update(users).set({ lastLoginAt: new Date(), loginFailCount: 0 }).where(eq(users.id, id));
}

export async function incrementLoginFail(id: string) {
  const db = getDb();
  const user = await getUserById(id);
  if (!user) return;
  const newCount = (user.loginFailCount || 0) + 1;
  const status = newCount >= 5 ? 'locked' : user.status;
  await db.update(users).set({ loginFailCount: newCount, status }).where(eq(users.id, id));
}

// ============================================================
// 角色服务
// ============================================================
export async function listRoles() {
  const db = getDb();
  const roleList = await db.select().from(roles).orderBy(roles.createdAt);

  // 附加权限信息
  const roleIds = roleList.map((r) => r.id);
  const allPerms = await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds));

  const permMap = new Map<string, string[]>();
  allPerms.forEach((p) => {
    if (!permMap.has(p.roleId)) permMap.set(p.roleId, []);
    permMap.get(p.roleId)!.push(`${p.permission}:${p.resource}`);
  });

  return roleList.map((r) => ({
    ...r,
    permissions: permMap.get(r.id) || [],
  }));
}

export async function getRoleById(id: string) {
  const db = getDb();
  const result = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return result[0] || null;
}

export async function getRoleByCode(code: string) {
  const db = getDb();
  const result = await db.select().from(roles).where(eq(roles.code, code)).limit(1);
  return result[0] || null;
}
