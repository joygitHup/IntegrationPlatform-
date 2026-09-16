'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { openApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Plug,
  Plus,
  RefreshCw,
  Loader2,
  Copy,
  Trash2,
  Database,
  Grid3X3,
  MessageSquare,
  Users,
  CheckCircle2,
  KeyRound,
  Pencil,
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

const TYPE_ICONS: Record<string, typeof Plug> = {
  application: Grid3X3,
  data: Database,
  messaging: MessageSquare,
  identity: Users,
};

const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,62}$/;

function suggestCode(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function formatDate(value?: string | null) {
  if (!value) return '从未使用';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN');
}

function copyText(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label}已复制`),
    () => toast.error('复制失败'),
  );
}

function snippet(apiKey: string) {
  const base = (process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api').replace(/\/+$/, '');
  const key = apiKey || 'ipk_你的密钥';
  return `# 0. 自助开通沙箱（也可由控制台发放）
curl -s -X POST ${base}/open/register \\
  -H "Content-Type: application/json" \\
  -d '{"name":"我的公司","code":"partner_demo"}'

# 1. 查看能力目录（公开）
curl -s ${base}/open/catalog

# SDK: GET ${base}/open/sdk  或  pip install -e sdk/python

# 2. 登记应用，保存返回的 secretKey
curl -s -X POST ${base}/open/apps \\
  -H "X-Api-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"name":"业务系统A","code":"sys_a","loginType":"jwt","loginUrl":"https://a.example.com/sso/consume"}'

# 3. 登记数据源
curl -s -X POST ${base}/open/datasources \\
  -H "X-Api-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"name":"源库","code":"src_mysql","type":"mysql","config":{"host":"127.0.0.1","port":3306,"database":"hr","user":"sync","password":"***"}}'

# 4. 钉钉 / 企微 / AD 拉取通讯录
curl -s -X POST ${base}/open/identity/pull \\
  -H "X-Api-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"datasourceId":"ds_xxx","jobId":"job_xxx","syncOrg":true,"executeJob":true}'

# 5. 快照回滚（先看 plan，再 execute）
curl -s -X POST ${base}/open/jobs/rollback \\
  -H "X-Api-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"jobId":"job_xxx","execute":true}'

# 6. A 已登录用户跳转 B（token 由来源应用 secretKey 签发）
curl -s -X POST ${base}/open/sso/launch \\
  -H "X-Api-Key: ${key}" -H "Content-Type: application/json" \\
  -d '{"from":"sys_a","to":"sys_b","token":"<A签发的JWT>"}'`;
}

export default function OpenServicesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('open:manage');

  const [catalog, setCatalog] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const emptyForm = {
    name: '',
    code: '',
    description: '',
    ipWhitelist: '',
    rateLimitPerMinute: 60,
    monthlyCallQuota: 0,
    monthlyRowQuota: 0,
    maxJobs: 0,
    maxSeats: 0,
    maxConnectors: 0,
    maxRowsMonthly: 0,
    maxApiCallsMonthly: 0,
    sandbox: false,
    alertEmail: '',
    alertWebhookUrl: '',
  };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [codeTouched, setCodeTouched] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusInfo, setStatusInfo] = useState<any>(null);
  const [errors, setErrors] = useState<any[]>([]);
  const [changelog, setChangelog] = useState<any[]>([]);

  const [revealedKey, setRevealedKey] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cat, list, status, err, log] = await Promise.all([
        openApi.catalog(),
        canManage ? openApi.clients.list() : Promise.resolve({ items: [] }),
        openApi.status().catch(() => null),
        openApi.errors().catch(() => ({ items: [] })),
        openApi.changelog().catch(() => ({ items: [] })),
      ]);
      setCatalog(cat);
      setClients(list.items || []);
      setStatusInfo(status);
      setErrors(err.items || []);
      setChangelog(log.items || []);
    } catch (error) {
      toast.error((error as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [canManage]);

  const whitelistLines = () =>
    form.ipWhitelist
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setCodeTouched(false);
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (client: any) => {
    setEditingId(client.id);
    setForm({
      name: client.name || '',
      code: client.code || '',
      description: client.description || '',
      ipWhitelist: (client.ipWhitelist || []).join('\n'),
      rateLimitPerMinute: client.rateLimitPerMinute ?? 60,
      monthlyCallQuota: client.monthlyCallQuota ?? 0,
      monthlyRowQuota: client.monthlyRowQuota ?? 0,
      maxJobs: client.entitlement?.maxJobs ?? 0,
      maxSeats: client.entitlement?.maxSeats ?? 0,
      maxConnectors: client.entitlement?.maxConnectors ?? 0,
      maxRowsMonthly: client.entitlement?.maxRowsMonthly ?? 0,
      maxApiCallsMonthly: client.entitlement?.maxApiCallsMonthly ?? 0,
      sandbox: Boolean(client.sandbox),
      alertEmail: client.alertEmail || '',
      alertWebhookUrl: client.alertWebhookUrl || '',
    });
    setCodeTouched(true);
    setFormError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    const code = form.code.trim();
    if (!name) {
      setFormError('请填写名称');
      return;
    }
    if (!editingId && !CODE_PATTERN.test(code)) {
      setFormError('编码需小写字母开头，仅含字母、数字、下划线和短横线');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name,
        description: form.description.trim(),
        ipWhitelist: whitelistLines(),
        rateLimitPerMinute: Number(form.rateLimitPerMinute) || 60,
        monthlyCallQuota: Number(form.monthlyCallQuota) || 0,
        monthlyRowQuota: Number(form.monthlyRowQuota) || 0,
        maxJobs: Number(form.maxJobs) || 0,
        maxSeats: Number(form.maxSeats) || 0,
        maxConnectors: Number(form.maxConnectors) || 0,
        maxRowsMonthly: Number(form.maxRowsMonthly) || 0,
        maxApiCallsMonthly: Number(form.maxApiCallsMonthly) || 0,
        sandbox: form.sandbox,
        alertEmail: form.alertEmail.trim(),
        alertWebhookUrl: form.alertWebhookUrl.trim(),
      };
      if (editingId) {
        await openApi.clients.update(editingId, payload);
        setDialogOpen(false);
        toast.success('凭证已更新');
      } else {
        const created = await openApi.clients.create({ ...payload, code });
        setDialogOpen(false);
        setRevealedKey(created.apiKey || '');
        toast.success('凭证已创建，请立即保存密钥');
      }
      await load();
    } catch (error) {
      setFormError((error as Error).message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRotate = async () => {
    if (!rotateId) return;
    try {
      const rotated = await openApi.clients.rotate(rotateId);
      setRotateId(null);
      setRevealedKey(rotated.apiKey || '');
      toast.success('密钥已轮换，旧密钥立即失效');
      await load();
    } catch (error) {
      toast.error((error as Error).message || '轮换失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await openApi.clients.delete(deleteId);
      toast.success('凭证已删除');
      setDeleteId(null);
      await load();
    } catch (error) {
      toast.error((error as Error).message || '删除失败');
    }
  };

  const types = catalog?.types || [];

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">开放服务</h1>
            <p className="text-sm text-muted-foreground">
              中台对外只提供集成服务。集成商用 API Key 接入应用、数据、消息与身份，控制台仅用于发放凭证与查看目录。
            </p>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {types.map((item: any) => {
            const Icon = TYPE_ICONS[item.code] || Plug;
            return (
              <Card key={item.code}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4 text-primary" />
                    {item.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{item.description}</p>
                  <div className="space-y-1">
                    {(item.quickStart || []).slice(0, 3).map((step: string) => (
                      <p key={step} className="text-xs leading-5 text-muted-foreground">
                        {step}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">集成凭证</CardTitle>
              {canManage && (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  发放密钥
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  加载中...
                </div>
              ) : clients.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  尚未发放凭证。创建后把 API Key 交给集成商即可调用开放接口。
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 font-medium">名称</th>
                        <th className="py-2 font-medium">编码</th>
                        <th className="py-2 font-medium">密钥前缀</th>
                        <th className="py-2 font-medium">限流 / 配额</th>
                        <th className="py-2 font-medium">用量</th>
                        <th className="py-2 font-medium">状态</th>
                        <th className="py-2 font-medium">最近使用</th>
                        <th className="py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map((client) => (
                        <tr key={client.id} className="border-b last:border-0">
                          <td className="py-3">{client.name}</td>
                          <td className="py-3 font-mono text-xs">{client.code}</td>
                          <td className="py-3 font-mono text-xs">{client.keyPrefix}...</td>
                          <td className="py-3 text-xs text-muted-foreground">
                            {client.sandbox ? '沙箱 · ' : ''}
                            {client.rateLimitPerMinute || 0}/分
                            {client.monthlyCallQuota ? ` · 月调用 ${client.monthlyCallQuota}` : ''}
                            {(client.ipWhitelist || []).length > 0 ? ` · IP ${client.ipWhitelist.length}` : ''}
                          </td>
                          <td className="py-3 text-xs text-muted-foreground">
                            今日 {client.usage?.today?.apiCalls ?? 0} 次
                            <br />
                            本月写入 {client.usage?.month?.rowsWritten ?? 0} 行
                          </td>
                          <td className="py-3">
                            <Badge variant={client.status === 'active' ? 'success' : 'secondary'}>
                              {client.status === 'active' ? '启用' : client.status}
                            </Badge>
                          </td>
                          <td className="py-3 text-muted-foreground">{formatDate(client.lastUsedAt)}</td>
                          <td className="py-3 text-right">
                            {canManage && (
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="sm" title="编辑" onClick={() => openEdit(client)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" title="轮换密钥" onClick={() => setRotateId(client.id)}>
                                  <KeyRound className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" title="删除" onClick={() => setDeleteId(client.id)}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">鉴权方式</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {catalog?.auth?.note || '密钥仅在创建时显示一次。'}
              </p>
              <div className="rounded-md bg-muted p-3 font-mono text-xs">
                X-Api-Key: ipk_...
              </div>
              <div className="rounded-md bg-muted p-3 font-mono text-xs">
                Authorization: Bearer ipk_...
              </div>
              <p className="text-xs text-muted-foreground">
                已接入 {catalog?.connectorCount ?? 0} 个连接器。目录接口无需密钥：
                <span className="ml-1 font-mono">GET /api/open/catalog</span>
              </p>
            </CardContent>
        </Card>
      </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">服务状态</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>状态：{statusInfo?.status || '未知'} · 环境 {statusInfo?.environment || '-'} · 队列 {statusInfo?.queueBackend || '-'}</p>
              <p className="text-xs">
                真实读写：{(statusInfo?.runtime?.extract || []).join('、') || '加载中'}
              </p>
              <p className="text-xs font-mono">GET /api/open/status · GET /api/open/openapi.json</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">错误码 / Changelog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              {(changelog[0]?.items || []).slice(0, 4).map((item: string) => (
                <p key={item}>· {item}</p>
              ))}
              <p className="pt-1 font-mono">
                GET /api/open/errors（{errors.length} 条） · GET /api/open/changelog
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">接入示例</CardTitle>
            <Button variant="outline" size="sm" onClick={() => copyText(snippet(revealedKey), '示例')}>
              <Copy className="mr-2 h-4 w-4" />
              复制
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-6">
              {snippet(revealedKey)}
            </pre>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !submitting && setDialogOpen(open)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑集成凭证' : '发放集成凭证'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? '更新白名单、限流与告警。轮换密钥请用表格中的钥匙按钮。'
                : '密钥只显示一次，请交给集成商后由对方自行保管。'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    name,
                    code: editingId || codeTouched ? prev.code : suggestCode(name),
                  }));
                }}
                placeholder="例如：某某集成商"
              />
            </div>
            <div className="space-y-2">
              <Label>编码</Label>
              <Input
                value={form.code}
                disabled={!!editingId}
                onChange={(e) => {
                  setCodeTouched(true);
                  setForm({ ...form, code: e.target.value.trim().toLowerCase() });
                }}
                placeholder="partner_acme"
              />
            </div>
            <div className="space-y-2">
              <Label>说明</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="用途、对接系统、联系人"
              />
            </div>
            <div className="space-y-2">
              <Label>IP 白名单</Label>
              <Textarea
                value={form.ipWhitelist}
                onChange={(e) => setForm({ ...form, ipWhitelist: e.target.value })}
                placeholder="每行一个 IP 或 CIDR，留空表示不限制"
                rows={3}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label>每分钟请求上限</Label>
              <Input
                type="number"
                value={form.rateLimitPerMinute}
                onChange={(e) => setForm({ ...form, rateLimitPerMinute: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.sandbox}
                onChange={(e) => setForm({ ...form, sandbox: e.target.checked })}
              />
              沙箱凭证（禁止创建 prod 资源）
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>月调用配额（0 不限）</Label>
                <Input
                  type="number"
                  value={form.monthlyCallQuota}
                  onChange={(e) => setForm({ ...form, monthlyCallQuota: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>月写入行配额（0 不限）</Label>
                <Input
                  type="number"
                  value={form.monthlyRowQuota}
                  onChange={(e) => setForm({ ...form, monthlyRowQuota: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">授权配额</Label>
                <span className="text-xs text-muted-foreground">全部 0 = 不限；私有化无授权记录默认全放行</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'maxJobs', label: '任务数上限' },
                  { key: 'maxSeats', label: '席位（用户）上限' },
                  { key: 'maxConnectors', label: '连接器（数据源）上限' },
                  { key: 'maxRowsMonthly', label: '月写入行数上限' },
                  { key: 'maxApiCallsMonthly', label: '月 API 调用上限' },
                ].map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label className="text-xs">{f.label}（0 不限）</Label>
                    <Input
                      type="number"
                      min={0}
                      value={(form as any)[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                SaaS 模式超限硬拒绝（资源 403 / 月度用量 429）；私有化模式仅告警不拦截。
              </p>
            </div>
            <div className="space-y-2">
              <Label>失败告警邮箱</Label>
              <Input
                value={form.alertEmail}
                onChange={(e) => setForm({ ...form, alertEmail: e.target.value })}
                placeholder="ops@partner.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>失败告警 Webhook</Label>
              <Input
                value={form.alertWebhookUrl}
                onChange={(e) => setForm({ ...form, alertWebhookUrl: e.target.value })}
                placeholder="https://partner.example.com/alerts"
              />
            </div>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedKey} onOpenChange={(open) => !open && setRevealedKey('')}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              请立即保存 API Key
            </DialogTitle>
            <DialogDescription>
              完整密钥不会再次展示。关闭后只能看到前缀。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md bg-muted p-3 font-mono text-xs break-all">
            {revealedKey}
            <Button variant="ghost" size="sm" onClick={() => copyText(revealedKey, '密钥')}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setRevealedKey('')}>已保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除凭证</AlertDialogTitle>
            <AlertDialogDescription>
              删除后集成商将无法再调用开放接口，且密钥无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!rotateId} onOpenChange={(open) => !open && setRotateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>轮换 API Key</AlertDialogTitle>
            <AlertDialogDescription>
              旧密钥会立即失效，集成商必须换成新密钥才能继续调用。新密钥只显示一次。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRotate}>确认轮换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
