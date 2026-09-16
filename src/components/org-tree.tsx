'use client';

import { useEffect, useState } from 'react';
import { orgDepartmentsApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronRight, ChevronDown, Building2, Users } from 'lucide-react';

export type OrgDeptNode = {
  id: string;
  sourceId: string;
  code?: string;
  name: string;
  fullName?: string;
  parentSourceId?: string;
  manager?: string;
  status?: string;
  children?: OrgDeptNode[];
};

function DeptBranch({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: OrgDeptNode;
  depth: number;
  selectedId: string | null;
  onSelect: (node: OrgDeptNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const children = node.children || [];
  const hasChildren = children.length > 0;
  const active = selectedId === node.sourceId;

  return (
    <div>
      <button
        type="button"
        className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60 ${active ? 'bg-muted' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <span
            className="flex h-4 w-4 items-center justify-center text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className="inline-block w-4" />
        )}
        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name || node.code || node.sourceId}</span>
        {node.status && node.status !== 'active' && (
          <Badge variant="secondary" className="ml-auto text-[10px]">{node.status}</Badge>
        )}
      </button>
      {open && hasChildren && children.map((child) => (
        <DeptBranch
          key={child.id || child.sourceId}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function OrgTreePanel({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tree, setTree] = useState<OrgDeptNode[]>([]);
  const [selected, setSelected] = useState<OrgDeptNode | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      setSelected(null);
      setUsers([]);
      try {
        const result = await orgDepartmentsApi.tree(jobId);
        if (!cancelled) setTree(result.items || []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message || '加载部门树失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (jobId) load();
    return () => { cancelled = true; };
  }, [jobId]);

  const selectDept = async (node: OrgDeptNode) => {
    setSelected(node);
    setUsersLoading(true);
    try {
      const result = await orgDepartmentsApi.users(jobId, node.sourceId, true);
      setUsers(result.items || []);
    } catch {
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return <p className="py-8 text-center text-sm text-destructive">{error}</p>;
  }
  if (tree.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        该任务还没有部门数据。身份源任务可先「拉通讯录」。
      </p>
    );
  }

  return (
    <div className="grid min-h-[360px] gap-4 md:grid-cols-[minmax(240px,1fr)_minmax(280px,1.2fr)]">
      <div className="overflow-auto rounded-md border p-2">
        {tree.map((node) => (
          <DeptBranch
            key={node.id || node.sourceId}
            node={node}
            depth={0}
            selectedId={selected?.sourceId || null}
            onSelect={selectDept}
          />
        ))}
      </div>
      <div className="rounded-md border p-3">
        {!selected ? (
          <p className="py-10 text-center text-sm text-muted-foreground">选择左侧部门查看成员</p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="font-medium">{selected.name}</p>
              <p className="text-xs text-muted-foreground">
                {selected.fullName || selected.code || selected.sourceId}
                {selected.manager ? ` · 负责人 ${selected.manager}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-muted-foreground" />
              成员（含下级）
              {!usersLoading && <Badge variant="secondary">{users.length}</Badge>}
            </div>
            {usersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground">该部门下没有人-部门关系</p>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">用户</th>
                      <th className="py-1.5 pr-2 font-medium">岗位</th>
                      <th className="py-1.5 font-medium">主部门</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 font-mono text-xs">{u.userSourceId || u.user_source_id || '-'}</td>
                        <td className="py-1.5 pr-2">{u.position || '-'}</td>
                        <td className="py-1.5">
                          {u.isPrimary || u.is_primary ? (
                            <Badge variant="success" className="text-[10px]">主</Badge>
                          ) : (
                            <span className="text-muted-foreground">兼</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

