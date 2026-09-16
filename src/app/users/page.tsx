'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { openApi, rolesApi, usersApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  USER_STATUS_MAP,
  buildUserPayload,
  emptyUserForm,
  formFromUser,
  resolveRoleList,
  roleLabel,
  validateUserForm,
  type UserForm,
} from '@/lib/user-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Plus,
  Search,
  Loader2,
  User,
  Shield,
  Edit,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type DialogMode = 'create' | 'edit' | 'view';

export default function UsersPage() {
  const { hasPermission, user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  // 仅平台账号可把用户指派给具体客户；/api/open/clients 仅平台可访问
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>('create');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState<UserForm>({ ...emptyUserForm });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [permCatalog, setPermCatalog] = useState<string[]>([]);
  const [roleDialog, setRoleDialog] = useState(false);
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [roleDeleteId, setRoleDeleteId] = useState<string | null>(null);
  const [roleForm, setRoleForm] = useState({
    id: '',
    code: '',
    name: '',
    description: '',
    permissions: [] as string[],
    protected: false,
  });

  const canWrite = hasPermission('user:write');
  // 平台账号自身 clientId 为空；客户账号禁止跨客户建人（后端也强制）
  const isPlatform = !currentUser?.clientId;
  const canAssignClient = isPlatform && hasPermission('open:manage');
  const canRole = canWrite || hasPermission('role:write');
  const canDelete = hasPermission('user:write') || hasPermission('user:delete');
  const readOnly = dialogMode === 'view';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    loadRoles();
  }, []);

  useEffect(() => {
    if (!canAssignClient) return;
    openApi.clients
      .list()
      .then((res: any) => setClients(res.items || []))
      .catch(() => setClients([]));
  }, [canAssignClient]);

  useEffect(() => {
    loadUsers();
  }, [status, page]);

  const loadRoles = async () => {
    try {
      const result = await rolesApi.list();
      setRoles(resolveRoleList(result));
      if (Array.isArray((result as any)?.catalog)) setPermCatalog((result as any).catalog);
    } catch {
      // 角色下拉失败时仍可浏览列表
    }
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (status) params.status = status;
      if (keyword) params.keyword = keyword;
      const result = await usersApi.list(params);
      setUsers(result.items || []);
      setTotal(result.total || 0);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    if (page === 1) loadUsers();
  };

  const openCreate = () => {
    setDialogMode('create');
    setEditingUser(null);
    setFormErrors({});
    setShowPassword(false);
    setFormData({
      ...emptyUserForm,
      roleId: roles[0]?.id || '',
      // 客户账号建人默认归属当前客户（后端强制，传仅作展示/兜底）
      clientId: isPlatform ? '' : currentUser?.clientId || '',
    });
    setDialogOpen(true);
  };

  const openEdit = async (user: any, mode: DialogMode) => {
    setDialogMode(mode);
    setEditingUser(user);
    setFormErrors({});
    setShowPassword(false);
    setFormData(formFromUser(user));
    setDialogOpen(true);
    try {
      const detail = await usersApi.get(user.id);
      setFormData(formFromUser(detail));
      setEditingUser(detail);
    } catch {
      // 详情失败时沿用列表数据
    }
  };

  const handleSubmit = async () => {
    if (dialogMode === 'view') {
      setDialogOpen(false);
      return;
    }
    const editing = dialogMode === 'edit';
    const errors = validateUserForm(formData, editing);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.error('请检查表单填写');
      return;
    }
    setSubmitting(true);
    try {
      const payload = buildUserPayload(formData, editing);
      if (editing && editingUser) {
        await usersApi.update(editingUser.id, payload);
        toast.success('用户已更新');
      } else {
        await usersApi.create(payload);
        toast.success('用户已创建');
      }
      setDialogOpen(false);
      loadUsers();
    } catch (error) {
      toast.error((error as Error).message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await usersApi.delete(deleteId);
      toast.success('删除成功');
      loadUsers();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  const dialogTitle =
    dialogMode === 'create' ? '新建用户' : dialogMode === 'edit' ? '编辑用户' : '用户详情';

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
            <p className="text-sm text-muted-foreground">管理平台用户、角色与权限</p>
          </div>
          {canWrite && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              新建用户
            </Button>
          )}
        </div>

        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索用户名或邮箱..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              {Object.entries(USER_STATUS_MAP).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={handleSearch}>搜索</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">共 {total} 位用户</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : users.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无用户
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">用户</th>
                      <th className="px-4 py-3 text-left font-medium">角色</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">最后登录</th>
                      <th className="px-4 py-3 text-left font-medium">创建时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const statusInfo = USER_STATUS_MAP[u.status] || { label: u.status, variant: 'secondary' };
                      const isSelf = u.id === currentUser?.id;
                      return (
                        <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                                <User className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">{u.displayName || u.username}</p>
                                <p className="text-xs text-muted-foreground">{u.email || u.username}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="flex w-fit items-center gap-1">
                              <Shield className="h-3 w-3" />
                              {roleLabel(u.roleCode, u.roleName)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusInfo.variant as any}>{statusInfo.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => openEdit(u, 'view')}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {canWrite && !isSelf && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => openEdit(u, 'edit')}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                              )}
                              {canDelete && !isSelf && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteId(u.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <div className="text-sm text-muted-foreground">
                  共 {total} 条，第 {page}/{totalPages} 页
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">角色与权限</CardTitle>
            {canRole && (
              <Button
                size="sm"
                onClick={() => {
                  setRoleForm({ id: '', code: '', name: '', description: '', permissions: [], protected: false });
                  setRoleDialog(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                新建角色
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {roles.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无角色</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium">角色</th>
                    <th className="px-4 py-3 text-left font-medium">编码</th>
                    <th className="px-4 py-3 text-left font-medium">权限数</th>
                    <th className="px-4 py-3 text-left font-medium">用户数</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                      <td className="px-4 py-3">{Array.isArray(r.permissions) ? r.permissions.length : '-'}</td>
                      <td className="px-4 py-3">{r.userCount ?? '-'}</td>
                      <td className="px-4 py-3 text-right">
                        {canRole && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => {
                                setRoleForm({
                                  id: r.id,
                                  code: r.code,
                                  name: r.name,
                                  description: r.description || '',
                                  permissions: Array.isArray(r.permissions) ? r.permissions : [],
                                  protected: Boolean(r.protected),
                                });
                                setRoleDialog(true);
                              }}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            {!r.protected && r.code !== 'admin' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-destructive"
                                onClick={() => setRoleDeleteId(r.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => !submitting && setDialogOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {dialogMode === 'create' && '填写账号信息并分配角色'}
              {dialogMode === 'edit' && '修改用户资料、角色或重置密码'}
              {dialogMode === 'view' && '查看用户账号信息'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>用户名 {dialogMode === 'create' && <span className="text-red-500">*</span>}</Label>
                <Input
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="字母开头，3-64 位"
                  disabled={dialogMode !== 'create'}
                  className={formErrors.username ? 'border-destructive' : ''}
                />
                {formErrors.username && <p className="text-xs text-destructive">{formErrors.username}</p>}
              </div>
              <div className="space-y-2">
                <Label>显示名称</Label>
                <Input
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  placeholder="可选，默认与用户名相同"
                  disabled={readOnly}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
                disabled={readOnly}
                className={formErrors.email ? 'border-destructive' : ''}
              />
              {formErrors.email && <p className="text-xs text-destructive">{formErrors.email}</p>}
            </div>
            <div className="space-y-2">
              <Label>所属客户</Label>
              {isPlatform ? (
                dialogMode === 'create' ? (
                  <Select
                    value={formData.clientId || '__platform__'}
                    onValueChange={(v) =>
                      setFormData({ ...formData, clientId: v === '__platform__' ? '' : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="请选择客户" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__platform__">平台账号（不归属客户）</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={
                      formData.clientId
                        ? clients.find((c) => c.id === formData.clientId)?.name || formData.clientId
                        : '平台账号'
                    }
                    disabled
                  />
                )
              ) : (
                <Input
                  value={
                    clients.find((c) => c.id === formData.clientId)?.name ||
                    formData.clientId ||
                    currentUser?.clientId ||
                    ''
                  }
                  disabled
                />
              )}
              <p className="text-xs text-muted-foreground">
                {isPlatform
                  ? '客户账号只能看到本客户的数据；留空为平台账号，可见全站。'
                  : '客户账号创建的用户强制归属当前客户，不可跨客户指派。'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>角色 <span className="text-red-500">*</span></Label>
                <Select
                  value={formData.roleId}
                  onValueChange={(v) => setFormData({ ...formData, roleId: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger className={formErrors.roleId ? 'border-destructive' : ''}>
                    <SelectValue placeholder="请选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {roleLabel(r.code, r.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.roleId && <p className="text-xs text-destructive">{formErrors.roleId}</p>}
              </div>
              <div className="space-y-2">
                <Label>状态</Label>
                <Select
                  value={formData.status}
                  onValueChange={(v) => setFormData({ ...formData, status: v })}
                  disabled={readOnly}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(USER_STATUS_MAP).map(([key, val]) => (
                      <SelectItem key={key} value={key}>{val.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {!readOnly && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    {dialogMode === 'create' ? '密码' : '新密码'}
                    {dialogMode === 'create' && <span className="text-red-500">*</span>}
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      placeholder={dialogMode === 'edit' ? '留空则不修改' : '至少 8 位，须含字母和数字'}
                      className={formErrors.password ? 'border-destructive pr-9' : 'pr-9'}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {formErrors.password && <p className="text-xs text-destructive">{formErrors.password}</p>}
                </div>
                <div className="space-y-2">
                  <Label>确认密码 {dialogMode === 'create' && <span className="text-red-500">*</span>}</Label>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    placeholder="再次输入密码"
                    className={formErrors.confirmPassword ? 'border-destructive' : ''}
                  />
                  {formErrors.confirmPassword && (
                    <p className="text-xs text-destructive">{formErrors.confirmPassword}</p>
                  )}
                </div>
              </div>
            )}
            {readOnly && editingUser && (
              <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                <div>最后登录：{editingUser.lastLoginAt ? new Date(editingUser.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</div>
                <div>登录失败次数：{editingUser.loginFailCount ?? 0}</div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              {readOnly ? '关闭' : '取消'}
            </Button>
            {!readOnly && (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {dialogMode === 'edit' ? '保存' : '创建'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后用户账号将无法恢复，确定要删除此用户吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!roleDeleteId} onOpenChange={(o) => !o && setRoleDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除角色</AlertDialogTitle>
            <AlertDialogDescription>删除后不可恢复。若仍有用户使用该角色将无法删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={async () => {
                if (!roleDeleteId) return;
                try {
                  await rolesApi.delete(roleDeleteId);
                  toast.success('角色已删除');
                  setRoleDeleteId(null);
                  loadRoles();
                } catch (error) {
                  toast.error((error as Error).message);
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={roleDialog} onOpenChange={setRoleDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{roleForm.id ? '编辑角色' : '新建角色'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>编码</Label>
                <Input
                  value={roleForm.code}
                  disabled={Boolean(roleForm.id)}
                  onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>名称</Label>
                <Input value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>说明</Label>
              <Input value={roleForm.description} onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>权限</Label>
              <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3">
                {(permCatalog.length ? permCatalog : roleForm.permissions).map((code) => {
                  const checked = roleForm.permissions.includes(code);
                  return (
                    <label key={code} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setRoleForm((prev) => ({
                            ...prev,
                            permissions: checked
                              ? prev.permissions.filter((p) => p !== code)
                              : [...prev.permissions, code],
                          }));
                        }}
                      />
                      {code}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(false)}>取消</Button>
            <Button
              disabled={roleSubmitting || !roleForm.name || !roleForm.code}
              onClick={async () => {
                setRoleSubmitting(true);
                try {
                  if (roleForm.id) {
                    await rolesApi.update(roleForm.id, {
                      name: roleForm.name,
                      description: roleForm.description,
                      permissions: roleForm.permissions,
                    });
                    toast.success('角色已更新');
                  } else {
                    await rolesApi.create({
                      code: roleForm.code,
                      name: roleForm.name,
                      description: roleForm.description,
                      permissions: roleForm.permissions,
                    });
                    toast.success('角色已创建');
                  }
                  setRoleDialog(false);
                  loadRoles();
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setRoleSubmitting(false);
                }
              }}
            >
              {roleSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
