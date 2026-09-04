/**
 * 组织架构同步服务
 * 支持：部门树同步、用户-部门关系同步、层级路径构建
 */
import { getDb } from '@/server/db';
import {
  departments,
  userDepartments,
  deptSyncExecutions,
  type NewDepartment,
  type NewUserDepartment,
  type NewDeptSyncExecution,
} from '@/server/db/schema/org-sync';
import { generateId } from '@/server/utils/id';
import { eq, and, isNull, desc, inArray } from 'drizzle-orm';

// ============================================================
// 部门 CRUD
// ============================================================
export async function listDepartments(params: {
  jobId: string;
  parentSourceId?: string | null;
  status?: string;
  includeDescendants?: boolean;
}): Promise<typeof departments.$inferSelect[]> {
  const db = getDb();

  const conditions = [eq(departments.jobId, params.jobId)];
  if (params.status) conditions.push(eq(departments.status, params.status));

  if (params.includeDescendants === false) {
    if (params.parentSourceId === undefined || params.parentSourceId === null) {
      conditions.push(isNull(departments.parentSourceId));
    } else {
      conditions.push(eq(departments.parentSourceId, params.parentSourceId));
    }
  }

  const items = await db.select().from(departments)
    .where(and(...conditions))
    .orderBy(departments.sortOrder, departments.name);

  return items;
}

export async function getDepartmentBySourceId(jobId: string, sourceId: string) {
  const db = getDb();
  const result = await db.select().from(departments)
    .where(and(eq(departments.jobId, jobId), eq(departments.sourceId, sourceId)))
    .limit(1);
  return result[0] || null;
}

// ============================================================
// 构建部门树
// ============================================================
export interface DepartmentNode {
  id: string;
  sourceId: string;
  code: string;
  name: string;
  fullName?: string | null;
  path?: string | null;
  depth: number;
  sortOrder: number;
  status: string;
  parentSourceId?: string | null;
  children: DepartmentNode[];
  manager?: string | null;
  attributes?: Record<string, unknown>;
}

export async function buildDepartmentTree(jobId: string, status?: string): Promise<DepartmentNode[]> {
  const allDepts = await listDepartments({ jobId, status });

  const nodeMap = new Map<string, DepartmentNode>();
  const roots: DepartmentNode[] = [];

  // 先创建所有节点
  for (const dept of allDepts) {
    nodeMap.set(dept.sourceId, {
      id: dept.id,
      sourceId: dept.sourceId,
      code: dept.code,
      name: dept.name,
      fullName: dept.fullName,
      path: dept.path,
      depth: dept.depth,
      sortOrder: dept.sortOrder,
      status: dept.status,
      parentSourceId: dept.parentSourceId,
      children: [],
      manager: dept.manager,
      attributes: dept.attributes,
    });
  }

  // 构建树
  for (const dept of allDepts) {
    const node = nodeMap.get(dept.sourceId)!;
    if (!dept.parentSourceId) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(dept.parentSourceId);
      if (parent) {
        parent.children.push(node);
      } else {
        // 父节点缺失 → 作为根节点
        roots.push(node);
      }
    }
  }

  // 按 sortOrder 排序
  function sortNodes(nodes: DepartmentNode[]) {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const node of nodes) {
      sortNodes(node.children);
    }
  }
  sortNodes(roots);

  return roots;
}

// ============================================================
// 批量同步部门（源系统 → 中台）
// ============================================================
export async function syncDepartments(params: {
  jobId: string;
  executionId: string;
  sourceDepartments: Array<{
    sourceId: string;
    code: string;
    name: string;
    fullName?: string;
    parentSourceId?: string | null;
    sortOrder?: number;
    manager?: string;
    status?: string;
    attributes?: Record<string, unknown>;
    sourceUpdatedAt?: Date;
  }>;
  // 是否删除源中不存在的部门
  deleteMissing?: boolean;
}): Promise<{
  total: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  failed: number;
  errorDetails: string[];
}> {
  const db = getDb();
  const { jobId, executionId, sourceDepartments, deleteMissing = false } = params;

  const result = {
    total: sourceDepartments.length,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    errorDetails: [] as string[],
  };

  // 第一步：按层级排序（先父后子）
  const sortedDepts = sortByHierarchy(sourceDepartments);

  // 第二步：逐个 upsert
  const existingSourceIds = new Set<string>();

  for (const srcDept of sortedDepts) {
    try {
      existingSourceIds.add(srcDept.sourceId);
      const existing = await getDepartmentBySourceId(jobId, srcDept.sourceId);

      // 计算 path 和 depth
      let path = `/${srcDept.code}`;
      let depth = 0;

      if (srcDept.parentSourceId) {
        const parent = await getDepartmentBySourceId(jobId, srcDept.parentSourceId);
        if (parent) {
          path = `${parent.path}/${srcDept.code}`;
          depth = parent.depth + 1;
        }
      }

      if (!existing) {
        const newDept: NewDepartment = {
          id: generateId('dept'),
          jobId,
          sourceId: srcDept.sourceId,
          code: srcDept.code,
          name: srcDept.name,
          fullName: srcDept.fullName,
          parentSourceId: srcDept.parentSourceId || null,
          path,
          depth,
          sortOrder: srcDept.sortOrder ?? 0,
          manager: srcDept.manager,
          status: srcDept.status || 'active',
          attributes: srcDept.attributes || {},
          dataSource: 'source',
          sourceUpdatedAt: srcDept.sourceUpdatedAt,
        };

        await db.insert(departments).values(newDept);
        result.created++;
      } else {
        await db.update(departments).set({
          code: srcDept.code,
          name: srcDept.name,
          fullName: srcDept.fullName,
          parentSourceId: srcDept.parentSourceId || null,
          path,
          depth,
          sortOrder: srcDept.sortOrder ?? existing.sortOrder,
          manager: srcDept.manager ?? existing.manager,
          status: srcDept.status || existing.status,
          attributes: { ...existing.attributes, ...(srcDept.attributes || {}) },
          sourceUpdatedAt: srcDept.sourceUpdatedAt || existing.sourceUpdatedAt,
          updatedAt: new Date(),
        }).where(eq(departments.id, existing.id));
        result.updated++;
      }
    } catch (err) {
      result.failed++;
      result.errorDetails.push(`部门 ${srcDept.sourceId} 同步失败: ${(err as Error).message}`);
    }
  }

  // 第三步：删除源中不存在的部门（可选）
  if (deleteMissing) {
    try {
      const allDepts = await listDepartments({ jobId });
      const toDelete = allDepts.filter((d) => !existingSourceIds.has(d.sourceId) && d.dataSource === 'source');

      for (const dept of toDelete) {
        await db.update(departments)
          .set({ status: 'inactive', updatedAt: new Date() })
          .where(eq(departments.id, dept.id));
        result.deleted++;
      }
    } catch (err) {
      result.errorDetails.push(`删除缺失部门失败: ${(err as Error).message}`);
    }
  }

  // 记录同步执行结果
  await db.insert(deptSyncExecutions).values({
    id: generateId('dse'),
    jobId,
    executionId,
    phase: 'dept',
    totalCount: result.total,
    createdCount: result.created,
    updatedCount: result.updated,
    deletedCount: result.deleted,
    failedCount: result.failed,
    skippedCount: result.skipped,
    errorSummary: result.errorDetails.slice(0, 10).join('; '),
  });

  return result;
}

// ============================================================
// 按层级排序（确保父部门先于子部门处理）
// ============================================================
function sortByHierarchy<T extends { sourceId: string; parentSourceId?: string | null }>(
  depts: T[],
): T[] {
  const sourceIdSet = new Set(depts.map((d) => d.sourceId));
  const result: typeof depts = [];
  const visited = new Set<string>();

  // BFS 从根节点开始
  const queue = depts.filter((d) => !d.parentSourceId || !sourceIdSet.has(d.parentSourceId));
  const remaining = new Map(depts.map((d) => [d.sourceId, d]));

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.sourceId)) continue;

    visited.add(current.sourceId);
    result.push(current);
    remaining.delete(current.sourceId);

    // 找出子节点
    for (const [sid, dept] of remaining) {
      if (dept.parentSourceId === current.sourceId) {
        queue.push(dept);
      }
    }
  }

  // 剩余的（有循环引用或父节点缺失的）追加到末尾
  for (const dept of remaining.values()) {
    result.push(dept);
  }

  return result;
}

// ============================================================
// 批量同步用户-部门关系
// ============================================================
export async function syncUserDepartments(params: {
  jobId: string;
  executionId: string;
  userDeptRelations: Array<{
    userSourceId: string;
    deptSourceId: string;
    isPrimary?: boolean;
    position?: string;
    joinedAt?: Date;
  }>;
  // 是否删除源中不存在的关系
  deleteMissing?: boolean;
}): Promise<{
  total: number;
  created: number;
  updated: number;
  deleted: number;
  failed: number;
  errorDetails: string[];
}> {
  const db = getDb();
  const { jobId, executionId, userDeptRelations, deleteMissing = false } = params;

  const result = {
    total: userDeptRelations.length,
    created: 0,
    updated: 0,
    deleted: 0,
    failed: 0,
    errorDetails: [] as string[],
  };

  const existingKeys = new Set<string>();

  for (const rel of userDeptRelations) {
    try {
      const key = `${rel.userSourceId}|${rel.deptSourceId}`;
      existingKeys.add(key);

      // 查找是否已存在
      const existing = await db.select().from(userDepartments)
        .where(and(
          eq(userDepartments.jobId, jobId),
          eq(userDepartments.userSourceId, rel.userSourceId),
          eq(userDepartments.deptSourceId, rel.deptSourceId),
        ))
        .limit(1);

      if (existing.length === 0) {
        const newRel: NewUserDepartment = {
          id: generateId('udept'),
          jobId,
          userSourceId: rel.userSourceId,
          deptSourceId: rel.deptSourceId,
          isPrimary: rel.isPrimary ?? false,
          position: rel.position,
          joinedAt: rel.joinedAt,
        };
        await db.insert(userDepartments).values(newRel);
        result.created++;
      } else {
        await db.update(userDepartments).set({
          isPrimary: rel.isPrimary ?? existing[0].isPrimary,
          position: rel.position ?? existing[0].position,
          joinedAt: rel.joinedAt ?? existing[0].joinedAt,
        }).where(eq(userDepartments.id, existing[0].id));
        result.updated++;
      }
    } catch (err) {
      result.failed++;
      result.errorDetails.push(`用户部门关系 ${rel.userSourceId}-${rel.deptSourceId} 同步失败: ${(err as Error).message}`);
    }
  }

  // 记录同步执行结果
  await db.insert(deptSyncExecutions).values({
    id: generateId('dse'),
    jobId,
    executionId,
    phase: 'user_dept',
    totalCount: result.total,
    createdCount: result.created,
    updatedCount: result.updated,
    deletedCount: result.deleted,
    failedCount: result.failed,
    skippedCount: 0,
    errorSummary: result.errorDetails.slice(0, 10).join('; '),
  });

  return result;
}

// ============================================================
// 获取用户的部门列表
// ============================================================
export async function getUserDepartments(jobId: string, userSourceId: string) {
  const db = getDb();
  return db.select().from(userDepartments)
    .where(and(eq(userDepartments.jobId, jobId), eq(userDepartments.userSourceId, userSourceId)))
    .orderBy(userDepartments.isPrimary);
}

// ============================================================
// 获取部门下的用户列表
// ============================================================
export async function getDepartmentUsers(jobId: string, deptSourceId: string, includeSubDepartments = false) {
  const db = getDb();

  let deptIds = [deptSourceId];

  if (includeSubDepartments) {
    // 递归获取所有子部门 sourceId
    const allDepts = await listDepartments({ jobId });
    const getChildren = (parentId: string): string[] => {
      const children = allDepts.filter((d) => d.parentSourceId === parentId).map((d) => d.sourceId);
      return [...children, ...children.flatMap(getChildren)];
    };
    deptIds = [...deptIds, ...getChildren(deptSourceId)];
  }

  return db.select().from(userDepartments)
    .where(and(
      eq(userDepartments.jobId, jobId),
      inArray(userDepartments.deptSourceId, deptIds),
    ));
}

// ============================================================
// 部门 CRUD（管理后台用）
// ============================================================
export async function createDepartment(params: {
  jobId: string;
  sourceId: string;
  code: string;
  name: string;
  parentSourceId?: string | null;
  fullName?: string;
  level?: number;
  sortOrder?: number;
  manager?: string;
  status?: 'active' | 'inactive';
  attributes?: Record<string, unknown>;
}): Promise<string> {
  const db = getDb();
  const id = generateId('dept');
  await db.insert(departments).values({
    id,
    jobId: params.jobId,
    sourceId: params.sourceId,
    code: params.code,
    name: params.name,
    parentSourceId: params.parentSourceId ?? null,
    fullName: params.fullName ?? params.name,
    depth: params.level ?? 1,
    sortOrder: params.sortOrder ?? 0,
    manager: params.manager ?? null,
    status: params.status ?? 'active',
    attributes: params.attributes ?? {},
    dataSource: 'manual',
  });
  return id;
}

export async function getDepartment(id: string) {
  const db = getDb();
  const rows = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateDepartment(id: string, data: Record<string, unknown>) {
  const db = getDb();
  const updateData: Record<string, unknown> = {};
  const allowedFields = ['code', 'name', 'parentSourceId', 'fullName', 'level', 'sortOrder', 'manager', 'status', 'attributes'];
  for (const field of allowedFields) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }
  updateData.updatedAt = new Date();
  await db.update(departments).set(updateData).where(eq(departments.id, id));
  return getDepartment(id);
}

export async function deleteDepartment(id: string) {
  const db = getDb();
  const result = await db.delete(departments).where(eq(departments.id, id));
  return result.changes > 0;
}

// ============================================================
// 树形结构查询（别名）
// ============================================================
export async function getDepartmentTree(jobId: string) {
  return buildDepartmentTree(jobId);
}

// ============================================================
// 从源系统同步组织架构（API 触发入口）
// ============================================================
export async function syncOrgFromSource(params: {
  jobId: string;
  departments: Array<Record<string, unknown>>;
  mode: 'full' | 'incremental';
  operatorId?: string;
}) {
  const mapped = params.departments.map((d) => ({
    sourceId: String(d.sourceId ?? d.id ?? ''),
    parentSourceId: d.parentSourceId !== undefined && d.parentSourceId !== null ? String(d.parentSourceId) : (d.parentId !== undefined && d.parentId !== null ? String(d.parentId) : null),
    code: String(d.code ?? d.sourceId ?? ''),
    name: String(d.name ?? ''),
    fullName: String(d.fullName ?? d.name ?? ''),
    sortOrder: d.sortOrder !== undefined ? Number(d.sortOrder) : 0,
    manager: d.manager ? String(d.manager) : undefined,
    status: (d.status as 'active' | 'inactive') ?? 'active',
    attributes: (d.attributes as Record<string, unknown>) ?? {},
    sourceUpdatedAt: d.updatedAt ? new Date(String(d.updatedAt)) : undefined,
  }));
  return syncDepartments({
    jobId: params.jobId,
    executionId: generateId('exec'),
    sourceDepartments: mapped,
  });
}

// ============================================================
// 部门下的用户列表（别名）
// ============================================================
export async function listDepartmentUsers(params: {
  jobId: string;
  deptSourceId: string;
  includeSubDepartments?: boolean;
}) {
  return getDepartmentUsers(params.jobId, params.deptSourceId, params.includeSubDepartments);
}
