'use client';

import { useEffect, useState } from 'react';
import { openApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

const ENV_KEY = 'ip_env';
const WS_KEY = 'ip_workspace';
const CODE_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function suggestCode(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (CODE_RE.test(slug)) return slug.slice(0, 64);
  return `ws_${Date.now().toString(36)}`;
}

export function ScopeSwitcher() {
  const { hasPermission } = useAuth();
  const [env, setEnv] = useState('all');
  const [workspace, setWorkspace] = useState('');
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const canManage = hasPermission('open:manage');

  useEffect(() => {
    setEnv(window.localStorage.getItem(ENV_KEY) || 'all');
    setWorkspace(window.localStorage.getItem(WS_KEY) || '');
    if (canManage) {
      openApi.workspaces().then((res) => setWorkspaces(res.items || [])).catch(() => setWorkspaces([]));
    }
  }, [canManage]);

  const apply = (nextEnv: string, nextWs: string) => {
    window.localStorage.setItem(ENV_KEY, nextEnv === 'all' ? '' : nextEnv);
    if (nextWs) window.localStorage.setItem(WS_KEY, nextWs);
    else window.localStorage.removeItem(WS_KEY);
    window.location.reload();
  };

  const submitWorkspace = async () => {
    const wsName = name.trim();
    const wsCode = (code.trim() || suggestCode(wsName)).trim();
    if (!wsName) {
      setError('请填写名称');
      return;
    }
    if (!CODE_RE.test(wsCode)) {
      setError('编码以字母开头，可含字母数字下划线中划线');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const created = await openApi.createWorkspace({ name: wsName, code: wsCode });
      apply(env || 'all', created.id);
    } catch (err: any) {
      setError(err?.message || '创建失败');
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-6 py-2 text-sm">
      <span className="text-muted-foreground">环境</span>
      <select
        className="h-8 rounded-md border bg-background px-2 text-xs"
        value={env || 'all'}
        onChange={(e) => apply(e.target.value, workspace)}
      >
        <option value="all">全部</option>
        <option value="dev">dev</option>
        <option value="staging">staging</option>
        <option value="prod">prod</option>
      </select>
      {canManage && (
        <>
          <span className="ml-2 text-muted-foreground">Workspace</span>
          <select
            className="h-8 min-w-[140px] rounded-md border bg-background px-2 text-xs"
            value={workspace}
            onChange={(e) => apply(env || 'all', e.target.value)}
          >
            <option value="">全部</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name || ws.code}
              </option>
            ))}
          </select>
          {!creating ? (
            <button
              type="button"
              className="h-8 rounded-md border bg-background px-2 text-xs"
              onClick={() => {
                setCreating(true);
                setName('');
                setCode('');
                setError('');
              }}
            >
              新建
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="h-8 w-32 rounded-md border bg-background px-2 text-xs"
                placeholder="名称"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!code) setCode(suggestCode(e.target.value));
                }}
              />
              <input
                className="h-8 w-32 rounded-md border bg-background px-2 text-xs font-mono"
                placeholder="编码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="h-8 rounded-md bg-primary px-2 text-xs text-primary-foreground disabled:opacity-50"
                disabled={saving}
                onClick={submitWorkspace}
              >
                {saving ? '创建中' : '创建并切换'}
              </button>
              <button
                type="button"
                className="h-8 rounded-md border bg-background px-2 text-xs"
                disabled={saving}
                onClick={() => {
                  setCreating(false);
                  setError('');
                }}
              >
                取消
              </button>
              {error && <span className="text-xs text-destructive">{error}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
