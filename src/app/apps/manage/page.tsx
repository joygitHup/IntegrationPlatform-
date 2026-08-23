'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { appsApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Loader2,
  RefreshCw,
  Settings,
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const loginTypeOptions = [
  { value: 'jwt', label: 'JWT 令牌跳转' },
  { value: 'ticket', label: '一次性 Ticket' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'saml', label: 'SAML 2.0' },
  { value: 'form_based', label: '表单代填' },
];

const categoryOptions = [
  { value: 'business', label: '业务系统' },
  { value: 'data', label: '数据平台' },
  { value: 'devops', label: '研发运维' },
  { value: 'collaboration', label: '协同办公' },
  { value: 'other', label: '其他' },
];

export default function AppsManagePage() {
  const { hasPermission } = useAuth();
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('__all__');
  const [status, setStatus] = useState('__all__');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<any>(null);
  const [formData, setFormData] = useState<any>({});
  const [submitting, setSubmitting] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const canWrite = hasPermission('app:write');
  const canDelete = hasPermission('app:delete');

  useEffect(() => {
    loadApps();
  }, [page, keyword, category, status]);

  const loadApps = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (keyword) params.keyword = keyword;
      if (category !== '__all__') params.category = category;
      if (status !== '__all__') params.status = status;
      const result = await appsApi.list(params);
      setApps(result.items || []);
      setTotal(result.total || 0);
    } catch (error) {
      console.error('Failed to load apps:', error);
      toast.error('加载应用列表失败');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingApp(null);
    setFormData({
      name: '',
      code: '',
      description: '',
      icon: '',
      category: 'business',
      loginType: 'jwt',
      loginUrl: '',
      logoutUrl: '',
      visible: true,
      sortOrder: 0,
    });
    setDialogOpen(true);
  };

  const openEdit = (app: any) => {
    setEditingApp(app);
    setFormData({
      name: app.name,
      code: app.code,
      description: app.description || '',
      icon: app.icon || '',
      category: app.category,
      loginType: app.loginType,
      loginUrl: app.loginUrl || '',
      logoutUrl: app.logoutUrl || '',
      visible: app.visible,
      sortOrder: app.sortOrder || 0,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name || !formData.code) {
      toast.error('请填写应用名称和编码');
      return;
    }
    setSubmitting(true);
    try {
      if (editingApp) {
        await appsApi.update(editingApp.id, formData);
        toast.success('应用更新成功');
      } else {
        await appsApi.create(formData);
        toast.success('应用创建成功');
      }
      setDialogOpen(false);
      loadApps();
    } catch (error: any) {
      toast.error(error.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await appsApi.delete(deleteId);
      toast.success('删除成功');
      setDeleteId(null);
      loadApps();
    } catch (error: any) {
      toast.error(error.message || '删除失败');
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">应用管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理可单点登录的外部应用</p>
        </div>

        {/* 操作栏 */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 items-center gap-3 flex-wrap">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索应用名称/编码..."
                  value={keyword}
                  onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
                  className="pl-10"
                />
              </div>
              <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部分类</SelectItem>
                  {categoryOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部状态</SelectItem>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="disabled">禁用</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={loadApps}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {canWrite && (
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                新建应用
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* 列表 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium">应用名称</th>
                    <th className="px-4 py-3 text-left font-medium">编码</th>
                    <th className="px-4 py-3 text-left font-medium">分类</th>
                    <th className="px-4 py-3 text-left font-medium">登录方式</th>
                    <th className="px-4 py-3 text-left font-medium">状态</th>
                    <th className="px-4 py-3 text-left font-medium">可见性</th>
                    <th className="px-4 py-3 text-left font-medium">排序</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                        暂无应用数据
                      </td>
                    </tr>
                  ) : (
                    apps.map((app) => (
                      <tr key={app.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-lg">
                              {app.icon || '🔗'}
                            </div>
                            <div>
                              <div className="font-medium">{app.name}</div>
                              <div className="text-xs text-muted-foreground line-clamp-1 max-w-xs">
                                {app.description}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{app.code}</td>
                        <td className="px-4 py-3">
                          {categoryOptions.find((c) => c.value === app.category)?.label || app.category}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">
                            {loginTypeOptions.find((t) => t.value === app.loginType)?.label || app.loginType}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={app.status === 'active' ? 'success' : 'secondary'} className="text-xs">
                            {app.status === 'active' ? '启用' : '禁用'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {app.visible ? (
                            <Eye className="h-4 w-4 text-green-600" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{app.sortOrder}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {canWrite && (
                              <Button variant="ghost" size="icon" onClick={() => openEdit(app)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="icon" className="text-red-600 hover:text-red-600" onClick={() => setDeleteId(app.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <div className="text-sm text-muted-foreground">
                共 {total} 条，第 {page}/{totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
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

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingApp ? '编辑应用' : '新建应用'}</DialogTitle>
            <DialogDescription>
              {editingApp ? '修改应用配置信息' : '添加一个新的单点登录应用'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">应用名称 <span className="text-red-500">*</span></Label>
                <Input
                  id="name"
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="如：企业邮箱"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">应用编码 <span className="text-red-500">*</span></Label>
                <Input
                  id="code"
                  value={formData.code || ''}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="如：email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">应用描述</Label>
              <Input
                id="description"
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="简要描述应用用途"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="icon">图标（Emoji）</Label>
                <Input
                  id="icon"
                  value={formData.icon || ''}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="📧"
                  className="text-xl"
                />
              </div>
              <div className="space-y-2">
                <Label>分类</Label>
                <Select
                  value={formData.category || 'business'}
                  onValueChange={(v) => setFormData({ ...formData, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>登录方式</Label>
              <Select
                value={formData.loginType || 'jwt'}
                onValueChange={(v) => setFormData({ ...formData, loginType: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {loginTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="loginUrl">登录地址</Label>
                <Input
                  id="loginUrl"
                  value={formData.loginUrl || ''}
                  onChange={(e) => setFormData({ ...formData, loginUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="logoutUrl">登出地址</Label>
                <Input
                  id="logoutUrl"
                  value={formData.logoutUrl || ''}
                  onChange={(e) => setFormData({ ...formData, logoutUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">在门户中显示</div>
                  <div className="text-xs text-muted-foreground">关闭后用户不可见</div>
                </div>
                <Switch
                  checked={formData.visible ?? true}
                  onCheckedChange={(v) => setFormData({ ...formData, visible: v })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">排序权重</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  value={formData.sortOrder ?? 0}
                  onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingApp ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除应用将同时清除相关的绑定关系和会话记录。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </AppLayout>
  );
}
