'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { appsApi, openApi } from '@/lib/api-client';
import {
  CATEGORY_OPTIONS,
  LOGIN_TYPE_OPTIONS,
  buildAppPayload,
  emptyAppForm,
  formFromAppDetail,
  suggestAppCode,
  validateAppForm,
} from '@/lib/app-form';
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
  Copy,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const [formData, setFormData] = useState({ ...emptyAppForm });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [codeTouched, setCodeTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [partners, setPartners] = useState<any[]>([]);

  const canWrite = hasPermission('app:write');
  const canDelete = hasPermission('app:delete');

  useEffect(() => {
    loadApps();
  }, [page, keyword, category, status]);

  useEffect(() => {
    if (hasPermission('open:manage')) {
      openApi.clients.list().then((r) => setPartners(r.items || [])).catch(() => setPartners([]));
    }
  }, [hasPermission]);

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
    setCodeTouched(false);
    setFormErrors({});
    setFormData({ ...emptyAppForm });
    setDialogOpen(true);
  };

  const openEdit = async (app: any) => {
    setEditingApp(app);
    setCodeTouched(true);
    setFormErrors({});
    setFormData(formFromAppDetail(app));
    setDialogOpen(true);
    try {
      const detail = await appsApi.get(app.id);
      setFormData(formFromAppDetail(detail));
    } catch {
      // 详情失败时沿用列表数据
    }
  };

  const handleSubmit = async () => {
    const errors = validateAppForm(formData);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      toast.error('请检查表单填写');
      return;
    }
    setSubmitting(true);
    try {
      const payload = buildAppPayload(formData);
      if (editingApp) {
        await appsApi.update(editingApp.id, payload);
        toast.success('应用更新成功');
      } else {
        const created = await appsApi.create(payload);
        toast.success('应用创建成功');
        if (created?.secretKey) {
          toast.info('已生成应用密钥，请妥善保存', { description: created.secretKey });
        }
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
                  {CATEGORY_OPTIONS.map((opt) => (
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
                    <th className="px-4 py-3 text-left font-medium">AppID / 编码</th>
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
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-xs text-muted-foreground">{app.id}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={() => {
                                  navigator.clipboard.writeText(app.id);
                                  toast.success('AppID 已复制');
                                }}
                                title="复制 AppID"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="font-mono text-xs text-muted-foreground/70">{app.code}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {CATEGORY_OPTIONS.find((c) => c.value === app.category)?.label || app.category}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">
                            {LOGIN_TYPE_OPTIONS.find((t) => t.value === app.loginType)?.label || app.loginType}
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
      <Dialog open={dialogOpen} onOpenChange={(o) => !submitting && setDialogOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingApp ? '编辑应用' : '新建应用'}</DialogTitle>
            <DialogDescription>
              {editingApp ? '修改应用配置信息' : '添加一个新的单点登录应用'}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basic">
            <TabsList>
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="login">登录配置</TabsTrigger>
            </TabsList>
            <TabsContent value="basic" className="grid gap-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>应用名称 <span className="text-red-500">*</span></Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setFormData((prev) => ({
                        ...prev,
                        name,
                        code: codeTouched || editingApp ? prev.code : (name ? suggestAppCode(name) : ''),
                      }));
                    }}
                    placeholder="如：企业邮箱"
                    className={formErrors.name ? 'border-destructive' : ''}
                  />
                  {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
                </div>
                <div className="space-y-2">
                  <Label>应用编码 <span className="text-red-500">*</span></Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => {
                      setCodeTouched(true);
                      setFormData({ ...formData, code: e.target.value });
                    }}
                    placeholder="如：email"
                    disabled={!!editingApp}
                    className={formErrors.code ? 'border-destructive' : ''}
                  />
                  {formErrors.code && <p className="text-xs text-destructive">{formErrors.code}</p>}
                </div>
              </div>
              <div className="space-y-2">
                <Label>应用描述</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="简要描述应用用途"
                />
              </div>
              <div className="space-y-2">
                <Label>所属集成商</Label>
                <select
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={formData.clientId || ''}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                >
                  <option value="">仅控制台可见（不开放给 Key）</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  指派后，该集成商的 API Key 可以看见并调用此应用。
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>图标（Emoji）</Label>
                  <Input
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    placeholder="📧"
                    className="text-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>分类</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">在门户中显示</div>
                    <div className="text-xs text-muted-foreground">关闭后用户不可见</div>
                  </div>
                  <Switch
                    checked={formData.visible}
                    onCheckedChange={(v) => setFormData({ ...formData, visible: v })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>排序权重</Label>
                  <Input
                    type="number"
                    value={formData.sortOrder}
                    onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </TabsContent>
            <TabsContent value="login" className="grid gap-4 pt-4">
              <div className="space-y-2">
                <Label>登录方式</Label>
                <Select value={formData.loginType} onValueChange={(v) => setFormData({ ...formData, loginType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LOGIN_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>登录地址 {['jwt', 'ticket', 'form_based'].includes(formData.loginType) && <span className="text-red-500">*</span>}</Label>
                  <Input
                    value={formData.loginUrl}
                    onChange={(e) => setFormData({ ...formData, loginUrl: e.target.value })}
                    placeholder="https://..."
                    className={formErrors.loginUrl ? 'border-destructive' : ''}
                  />
                  {formErrors.loginUrl && <p className="text-xs text-destructive">{formErrors.loginUrl}</p>}
                </div>
                <div className="space-y-2">
                  <Label>登出地址</Label>
                  <Input
                    value={formData.logoutUrl}
                    onChange={(e) => setFormData({ ...formData, logoutUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>回调地址</Label>
                <Input
                  value={formData.callbackUrl}
                  onChange={(e) => setFormData({ ...formData, callbackUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              {formData.loginType === 'jwt' && (
                <div className="space-y-2">
                  <Label>JWT 有效期（秒）</Label>
                  <Input
                    type="number"
                    value={formData.jwtExpiresIn}
                    onChange={(e) => setFormData({ ...formData, jwtExpiresIn: parseInt(e.target.value) || 30 })}
                  />
                </div>
              )}
              {formData.loginType === 'ticket' && (
                <div className="space-y-2">
                  <Label>Ticket 有效期（秒）</Label>
                  <Input
                    type="number"
                    value={formData.ticketExpiresIn}
                    onChange={(e) => setFormData({ ...formData, ticketExpiresIn: parseInt(e.target.value) || 60 })}
                  />
                </div>
              )}
              {formData.loginType === 'oauth2' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>授权地址 <span className="text-red-500">*</span></Label>
                    <Input
                      value={formData.oauthAuthUrl}
                      onChange={(e) => setFormData({ ...formData, oauthAuthUrl: e.target.value })}
                      placeholder="https://idp.example.com/authorize"
                      className={formErrors.oauthAuthUrl ? 'border-destructive' : ''}
                    />
                    {formErrors.oauthAuthUrl && <p className="text-xs text-destructive">{formErrors.oauthAuthUrl}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Client ID</Label>
                    <Input value={formData.oauthClientId} onChange={(e) => setFormData({ ...formData, oauthClientId: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Client Secret</Label>
                    <Input type="password" value={formData.oauthClientSecret} onChange={(e) => setFormData({ ...formData, oauthClientSecret: e.target.value })} placeholder="留空则不修改" />
                  </div>
                  <div className="space-y-2">
                    <Label>Token URL</Label>
                    <Input value={formData.oauthTokenUrl} onChange={(e) => setFormData({ ...formData, oauthTokenUrl: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>UserInfo URL</Label>
                    <Input value={formData.oauthUserinfoUrl} onChange={(e) => setFormData({ ...formData, oauthUserinfoUrl: e.target.value })} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Scope</Label>
                    <Input value={formData.oauthScope} onChange={(e) => setFormData({ ...formData, oauthScope: e.target.value })} placeholder="openid profile email" />
                  </div>
                </div>
              )}
              {formData.loginType === 'saml' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>IdP Metadata URL</Label>
                    <Input value={formData.samlIdpMetadataUrl} onChange={(e) => setFormData({ ...formData, samlIdpMetadataUrl: e.target.value })} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>SP Entity ID</Label>
                    <Input value={formData.samlSpEntityId} onChange={(e) => setFormData({ ...formData, samlSpEntityId: e.target.value })} />
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>取消</Button>
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
