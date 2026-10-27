'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { appsApi, openApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Download,
  Package,
  Hammer,
  FileText,
  Code2,
  ShieldCheck,
  LayoutTemplate,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

// 后端 API 基地址（含版本号），如 http://127.0.0.1:8000/api/v1
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api').replace(/\/+$/, '');
// 站点根（去掉 /api 与可选版本号），用于拼接对外绝对链接
const PLATFORM_ORIGIN = API_BASE.replace(/\/api(\/v\d+)?$/, '');

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

function EmbedAlgorithmBlock() {
  const [lang, setLang] = useState<'python' | 'java' | 'node'>('python');

  const snippets: Record<string, string> = {
    python: `import hmac, hashlib, time

# 你的 IntegrationClient.id 和 embed_token
client_id  = "ic_xxxxx"
embed_token = "48 位十六进制（从平台 POST /api/embed/token 拿到）"

ts = str(int(time.time()))            # 秒级 Unix 时间戳
sig = hmac.new(
    embed_token.encode(),
    f"{client_id}.{ts}".encode(),
    hashlib.sha256,
).hexdigest()

token = f"{ts}.{sig}"                 # 塞进 iframe URL`,

    java: `import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;

String clientId  = "ic_xxxxx";
String embedToken = "48 位十六进制";

String ts = String.valueOf(System.currentTimeMillis() / 1000);
String data = clientId + "." + ts;

Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(embedToken.getBytes(), "HmacSHA256"));
byte[] raw = mac.doFinal(data.getBytes());

// byte[] → hex
StringBuilder sb = new StringBuilder();
for (byte b : raw) sb.append(String.format("%02x", b));
String token = ts + "." + sb.toString();`,

    node: `const crypto = require('crypto');

const clientId  = 'ic_xxxxx';
const embedToken = '48 位十六进制';

const ts = Math.floor(Date.now() / 1000);
const sig = crypto.createHmac('sha256', embedToken)
  .update(\`\${clientId}.\${ts}\`)
  .digest('hex');

const token = \`\${ts}.\${sig}\`;  // 塞进 iframe URL`,
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(['python', 'java', 'node'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLang(l)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              lang === l
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {l === 'python' ? 'Python' : l === 'java' ? 'Java' : 'Node.js'}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => copyText(snippets[lang], '代码')}
        >
          <Copy className="mr-1 h-3 w-3" />
          复制
        </Button>
      </div>
      <pre className="overflow-x-auto rounded bg-muted p-3 text-xs leading-5 font-mono">
        {snippets[lang]}
      </pre>
      <p className="text-[11px] text-muted-foreground">
        格式：<code className="font-mono">{'token = "{unix_ts}.{HMAC-SHA256(client_id + "." + ts, embed_token)}"'}</code>
      </p>
    </div>
  );
}

const PLAN_FIELDS: [string, string][] = [
  ['monthlyBaseFee', '基费 / 月'],
  ['pricePerRow', '行写入单价'],
  ['pricePerApiCall', 'API 调用单价'],
  ['freeRowsPerMonth', '免费行 / 月'],
  ['freeApiCallsPerMonth', '免费调用 / 月'],
  ['taxRate', '税率（小数，如 0.06）'],
];

/** 表单里的数字都是字符串，提交前统一转 number；空串保留 0 */
function coerceNumbers(form: Record<string, any>): Record<string, number> {
  const out: Record<string, number> = {};
  Object.entries(form).forEach(([k, v]) => {
    if (v === '' || v === null || v === undefined) {
      out[k] = 0;
    } else if (typeof v === 'string') {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : 0;
    } else {
      out[k] = Number(v) || 0;
    }
  });
  return out;
}

/** 上月账期 YYYY-MM（生成账单默认账期） */
function lastMonthKey(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function BillingTab({ isPlatform, canManage }: { isPlatform: boolean; canManage: boolean }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [planForm, setPlanForm] = useState<Record<string, any>>({});
  const [newPlanForm, setNewPlanForm] = useState<Record<string, any>>({
    monthlyBaseFee: 0,
    pricePerRow: 0.005,
    pricePerApiCall: 0.001,
    freeRowsPerMonth: 0,
    freeApiCallsPerMonth: 0,
    taxRate: 0.06,
  });

  const load = async () => {
    setLoading(true);
    try {
      const [plansResp, invResp, usageResp, clientsResp] = await Promise.all([
        openApi.billingPlans().catch(() => []),
        openApi.invoices().catch(() => []),
        openApi.usage().catch(() => null),
        isPlatform ? openApi.clients.list().catch(() => []) : Promise.resolve([]),
      ]);
      const list = Array.isArray(plansResp) ? plansResp : (plansResp?.items ?? []);
      setPlans(list);
      const clientList = Array.isArray(clientsResp) ? clientsResp : (clientsResp?.items ?? []);
      setClients(clientList);
      const invList = Array.isArray(invResp) ? invResp : (invResp?.items ?? []);
      setInvoices(invList.sort((a: any, b: any) => (a.periodStart < b.periodStart ? 1 : -1)));
      setUsage(usageResp);
    } catch (e) {
      toast.error((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  // 平台账号可切换客户查看/配置；集成商只会拿到自己那一行（后端按 clientId 过滤）
  const activeClientId = isPlatform
    ? (selectedClientId || clients[0]?.id || '')
    : (plans[0]?.clientId || '');
  const plan = plans.find((p: any) => !activeClientId || p.clientId === activeClientId) ?? null;
  const visibleInvoices = isPlatform && activeClientId
    ? invoices.filter((i: any) => i.clientId === activeClientId)
    : invoices;
  const activeClient = clients.find((c: any) => c.id === activeClientId) ?? null;

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const data = await openApi.previewInvoice(isPlatform ? activeClientId : undefined);
      setPreview(data);
      toast.success('已生成本月预估账单');
    } catch (e) {
      toast.error((e as Error).message || '预览失败');
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 账单状态流转：作废 / 标记已支付
  const handleStatus = async (inv: any, action: 'void' | 'pay') => {
    const label = action === 'pay' ? '标记为已支付' : '作废';
    if (!window.confirm(`确认${label}账单 ${inv.invoiceNumber || inv.id}？`)) return;
    setActing(inv.id);
    try {
      const reason = action === 'void'
        ? window.prompt('作废原因（可留空）') || ''
        : undefined;
      await openApi.invoiceAction(action, inv.id, reason);
      toast.success(`${label}成功`);
      await load();
    } catch (e) {
      toast.error((e as Error).message || `${label}失败`);
    } finally {
      setActing(null);
    }
  };

  // 下载 PDF（带 JWT 拉 blob 后触发浏览器下载）
  const handlePdf = async (inv: any) => {
    setActing(inv.id);
    try {
      const blob = await openApi.downloadInvoicePdf(inv.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${inv.invoiceNumber || inv.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message || 'PDF 下载失败');
    } finally {
      setActing(null);
    }
  };

  // 套餐更新（PUT）
  const handleSavePlan = async () => {
    if (!plan?.id) return;
    setSaving(true);
    try {
      await openApi.updatePlan(plan.id, coerceNumbers(planForm));
      toast.success('计费套餐已更新');
      setEditing(false);
      setPlanForm({});
      await load();
    } catch (e) {
      toast.error((e as Error).message || '套餐更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 新建套餐（平台首次为客户配置资费）
  const handleCreatePlan = async () => {
    if (!activeClientId) {
      toast.error('请先选择要配置资费的客户');
      return;
    }
    setSaving(true);
    try {
      await openApi.createPlan({ clientId: activeClientId, ...coerceNumbers(newPlanForm) });
      toast.success('计费套餐已创建');
      setCreating(false);
      await load();
    } catch (e) {
      toast.error((e as Error).message || '套餐创建失败');
    } finally {
      setSaving(false);
    }
  };

  // 手动生成账单（默认上月）
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const month = lastMonthKey();
      const resp = await openApi.generateInvoice(month, isPlatform ? activeClientId : undefined);
      toast.success(`已生成 ${month} 账单（${resp?.generated ?? 0} 张）`);
      await load();
    } catch (e) {
      toast.error((e as Error).message || '账单生成失败');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />加载中...
      </CardContent></Card>
    );
  }

  const freeRows = plan?.freeRowsPerMonth ?? 0;
  const freeCalls = plan?.freeApiCallsPerMonth ?? 0;
  const rowPrice = plan?.pricePerRow ?? 0;
  const callPrice = plan?.pricePerApiCall ?? 0;
  const baseFee = plan?.monthlyBaseFee ?? 0;
  const taxRate = plan?.taxRate ?? 0;
  const currency = plan?.currency ?? 'CNY';

  const monthRows = usage?.month?.rowsWritten ?? 0;
  const monthCalls = usage?.month?.apiCalls ?? 0;
  const rowQuota = usage?.quotas?.monthlyRowQuota || usage?.entitlements?.maxRowsMonthly || 0;
  const callQuota = usage?.quotas?.monthlyCallQuota || usage?.entitlements?.maxApiCallsMonthly || 0;

  const rowPct = rowQuota > 0 ? Math.min(100, Math.round((monthRows / rowQuota) * 100)) : 0;
  const callPct = callQuota > 0 ? Math.min(100, Math.round((monthCalls / callQuota) * 100)) : 0;

  const fmt = (n: number) => n.toLocaleString('zh-CN');
  const fmtMoney = (n: number) => `${currency} ${Number(n).toFixed(2)}`;

  return (
    <div className="space-y-6">
      {isPlatform && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-3">
            <span className="text-xs text-muted-foreground">查看客户</span>
            <Select
              value={activeClientId}
              onValueChange={(v) => { setSelectedClientId(v); setPreview(null); setEditing(false); setCreating(false); }}
            >
              <SelectTrigger className="h-8 w-64 text-xs">
                <SelectValue placeholder="选择客户" />
              </SelectTrigger>
              <SelectContent>
                {clients.length === 0 ? (
                  <SelectItem value="__none" disabled>暂无集成商客户</SelectItem>
                ) : (
                  clients.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.code || c.id}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {activeClient && (
              <span className="text-xs text-muted-foreground">
                客户编码：<span className="font-mono">{activeClient.code || '-'}</span>
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {/* 套餐卡片 + 用量进度 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">当前计费套餐</CardTitle>
            {plan && canManage && !editing && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                onClick={() => {
                  setPlanForm({
                    pricePerRow: rowPrice,
                    pricePerApiCall: callPrice,
                    monthlyBaseFee: baseFee,
                    freeRowsPerMonth: freeRows,
                    freeApiCallsPerMonth: freeCalls,
                    taxRate,
                  });
                  setEditing(true);
                }}>
                <Pencil className="mr-1 h-3 w-3" />编辑
              </Button>
            )}
            {!plan && canManage && !creating && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setCreating(true)}>
                <Plus className="mr-1 h-3 w-3" />新建套餐
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {plan && editing && (
              <div className="space-y-2 rounded-md border p-2.5">
                {PLAN_FIELDS.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <Input className="h-7 w-28 text-xs" type="number" step="0.0001"
                      value={planForm[key] ?? ''}
                      onChange={(e) => setPlanForm((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditing(false); setPlanForm({}); }}>
                    取消
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={handleSavePlan} disabled={saving}>
                    {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}保存
                  </Button>
                </div>
              </div>
            )}
            {creating && canManage && (
              <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/50 p-2.5 dark:border-sky-900 dark:bg-sky-950/20">
                <p className="text-xs font-medium text-sky-900 dark:text-sky-200">
                  为 {activeClient?.name || '当前客户'} 配置计费套餐
                </p>
                {PLAN_FIELDS.map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <Input className="h-7 w-28 text-xs" type="number" step="0.0001"
                      value={newPlanForm[key] ?? ''}
                      onChange={(e) => setNewPlanForm((f) => ({ ...f, [key]: e.target.value }))} />
                  </div>
                ))}
                <div className="flex justify-end gap-2 pt-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCreating(false)}>
                    取消
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={handleCreatePlan} disabled={saving || !activeClientId}>
                    {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}创建
                  </Button>
                </div>
              </div>
            )}
            {plan ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">基费 / 月</span>
                    <span className="font-medium">{fmtMoney(baseFee)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">币种</span>
                    <span className="font-medium">{currency}</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">行写入单价</span>
                    <span className="font-medium">{fmtMoney(rowPrice)} / 行</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">API 调用单价</span>
                    <span className="font-medium">{fmtMoney(callPrice)} / 次</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">免费行 / 月</span>
                    <span className="font-medium">{fmt(freeRows)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">免费调用 / 月</span>
                    <span className="font-medium">{fmt(freeCalls)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">税率</span>
                    <span className="font-medium">{(taxRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between rounded bg-muted/40 px-2 py-1.5">
                    <span className="text-muted-foreground">状态</span>
                    <Badge variant={plan.status === 'active' ? 'success' : 'secondary'}>{plan.status}</Badge>
                  </div>
                </div>
              </>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                尚未配置计费套餐（免费额度内不产生账单）
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">本月用量</CardTitle>
            <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewing}>
              {previewing && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              预估本月账单
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageBar label="行写入" used={monthRows} quota={rowQuota} pct={rowPct} />
            <UsageBar label="API 调用" used={monthCalls} quota={callQuota} pct={callPct} />
            {preview && (
              <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/40">
                <p className="mb-2 font-medium text-sky-900 dark:text-sky-200">本月预估（{preview.periodStart || '-'} ~ {preview.periodEnd || '-'}）</p>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <span>行写入：{fmt(preview.rowsWritten ?? 0)} / 计费 {fmt(preview.rowsInvoiced ?? 0)}</span>
                  <span>API 调用：{fmt(preview.apiCalls ?? 0)} / 计费 {fmt(preview.apiCallsInvoiced ?? 0)}</span>
                  <span>基费：{fmtMoney(preview.baseFee ?? 0)}</span>
                  <span>行费用：{fmtMoney(preview.rowsAmount ?? 0)}</span>
                  <span>调用费用：{fmtMoney(preview.apiCallsAmount ?? 0)}</span>
                  <span>税额：{fmtMoney(preview.taxAmount ?? 0)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-sky-900 dark:text-sky-200">
                  预计总额：{fmtMoney(preview.totalAmount ?? 0)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 历史账单 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">历史账单</CardTitle>
          {canManage && (
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={handleGenerate} disabled={generating || (isPlatform && !activeClientId)}>
              {generating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              生成上月账单
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {visibleInvoices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              暂无账单记录。每月 1 号 00:10 自动生成上月账单。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 font-medium">账期</th>
                    <th className="py-2 font-medium">行写入</th>
                    <th className="py-2 font-medium">API 调用</th>
                    <th className="py-2 font-medium">基费</th>
                    <th className="py-2 font-medium">小计</th>
                    <th className="py-2 font-medium">税额</th>
                    <th className="py-2 font-medium">总额</th>
                    <th className="py-2 font-medium">状态</th>
                    <th className="py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="py-2.5 font-mono text-xs">
                        {inv.periodStart?.slice(0, 7)}
                      </td>
                      <td className="py-2.5 text-xs">
                        {fmt(inv.rowsWritten ?? 0)}
                        {(inv.rowsInvoiced ?? 0) !== (inv.rowsWritten ?? 0) && (
                          <span className="ml-1 text-muted-foreground">({fmt(inv.rowsInvoiced)} 计费)</span>
                        )}
                      </td>
                      <td className="py-2.5 text-xs">
                        {fmt(inv.apiCalls ?? 0)}
                        {(inv.apiCallsInvoiced ?? 0) !== (inv.apiCalls ?? 0) && (
                          <span className="ml-1 text-muted-foreground">({fmt(inv.apiCallsInvoiced)} 计费)</span>
                        )}
                      </td>
                      <td className="py-2.5 text-xs">{fmtMoney(inv.baseFee ?? 0)}</td>
                      <td className="py-2.5 text-xs">{fmtMoney(inv.subtotal ?? 0)}</td>
                      <td className="py-2.5 text-xs">{fmtMoney(inv.taxAmount ?? 0)}</td>
                      <td className="py-2.5 text-sm font-semibold">{fmtMoney(inv.totalAmount ?? 0)}</td>
                      <td className="py-2.5">
                        <Badge variant={
                          inv.status === 'paid' ? 'success' :
                          inv.status === 'issued' ? 'outline' :
                          inv.status === 'void' ? 'destructive' : 'secondary'
                        } className="text-[10px]">
                          {inv.status === 'paid' ? '已支付'
                            : inv.status === 'issued' ? '已开票'
                            : inv.status === 'void' ? '已作废' : '草稿'}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {inv.status === 'issued' && (
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                              disabled={acting === inv.id} onClick={() => handleStatus(inv, 'pay')}>
                              标记支付
                            </Button>
                          )}
                          {(inv.status === 'draft' || inv.status === 'issued') && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive"
                              disabled={acting === inv.id} onClick={() => handleStatus(inv, 'void')}>
                              作废
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                            disabled={acting === inv.id} onClick={() => handlePdf(inv)}>
                            <Download className="mr-1 h-3 w-3" />PDF
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UsageBar({ label, used, quota, pct }: { label: string; used: number; quota: number; pct: number }) {
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-primary';
  const fmt = (n: number) => n.toLocaleString('zh-CN');
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {fmt(used)} {quota > 0 && `/ ${fmt(quota)}`}
          {quota > 0 && <span className="ml-1 font-semibold text-foreground">· {pct}%</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function snippet(apiKey: string) {
  const base = API_BASE;
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
  const { hasPermission, user } = useAuth();
  const canManage = hasPermission('open:manage');
  const isPlatform = !user?.clientId;

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
  const [sdkData, setSdkData] = useState<any>(null);
  const [building, setBuilding] = useState(false);
  const [apps, setApps] = useState<any[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [selectedApp, setSelectedApp] = useState<any>(null);

  const [revealedKey, setRevealedKey] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rotateId, setRotateId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [cat, list, status, err, log, sdk, appsResp] = await Promise.all([
        openApi.catalog(),
        isPlatform && canManage ? openApi.clients.list() : Promise.resolve({ items: [] }),
        openApi.status().catch(() => null),
        openApi.errors().catch(() => ({ items: [] })),
        openApi.changelog().catch(() => ({ items: [] })),
        openApi.sdk().catch(() => null),
        appsApi.list({ pageSize: 100 }).catch(() => ({ items: [] })),
      ]);
      setCatalog(cat);
      setClients(list.items || []);
      setStatusInfo(status);
      setErrors(err.items || []);
      setChangelog(log.items || []);
      setSdkData(sdk);
      const appsList = appsResp.items || [];
      setApps(appsList);
      if (appsList.length > 0 && !selectedAppId) {
        setSelectedAppId(appsList[0].id);
        setSelectedApp(appsList[0]);
      }
    } catch (error) {
      toast.error((error as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectApp = async (id: string) => {
    setSelectedAppId(id);
    try {
      const detail = await appsApi.get(id);
      setSelectedApp(detail);
    } catch (error) {
      const fallback = apps.find((a) => a.id === id);
      setSelectedApp(fallback || null);
      toast.error((error as Error).message || '应用详情加载失败');
    }
  };

  const buildIntegrationGuide = () => {
    if (!selectedApp) return '';
    const platformUrl = PLATFORM_ORIGIN;
    const useRsa = selectedApp.settings?.useRsa === true || selectedApp.settings?.useRsa === 'true';
    const wheel = sdkData?.latest?.filename || 'integration_hub-1.5.0-py3-none-any.whl';
    const guide = `# ${selectedApp.name} SSO 对接清单

## 一、中台侧信息（已配置好）

| 项 | 值 |
|---|---|
| 中台地址 | ${platformUrl} |
| AppID | ${selectedApp.id} |
| Audience (应用 code) | ${selectedApp.code} |
| 验签模式 | ${useRsa ? 'RS256（推荐，本地验签）' : 'HS256（需调中台 validate）'} |
| JWKS 公钥 | ${API_BASE}/sso/.well-known/jwks.json |
| SDK wheel | ${wheel}（从中台"开放服务 → SDK 构建与下载"获取） |

## 二、对方需要做的 3 件事

### 1. 安装 SDK

\`\`\`bash
pip install ${wheel}
\`\`\`

### 2. SDK 配置（Django settings.py 启动时执行一次）

\`\`\`python
from integration_hub.sso import configure
configure(
    platform_url="${platformUrl}",
    audience="${selectedApp.code}",
    app_id="${selectedApp.id}",
    auto_create_user=True,
    default_redirect="/dashboard",
    # 敏感系统开启：本地验签后再回调中台确认未被踢下线（默认 False）
    check_revocation=False,
)
\`\`\`

### 3. 挂载落地路由（两种方式二选一，推荐 A）

**方式 A：函数视图（推荐，不改动 MIDDLEWARE）**

\`\`\`python
# urls.py
from integration_hub.sso.middleware import django_sso_callback_view
urlpatterns += [path("sso/callback", django_sso_callback_view, name="sso-callback")]
\`\`\`

**方式 B：全局中间件（所有请求都会经过 /sso/callback 判断）**

\`\`\`python
# settings.py（不要再重复挂 urls）
MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]
\`\`\`

> FastAPI 用 \`fastapi_callback()\`，但必须先挂 \`SessionMiddleware\`；Flask 用 \`flask_callback(app)\`。

## 三、对方要处理的 URL 形态

\`\`\`
${selectedApp.loginUrl || `http://对方域名/sso/callback`}?token=eyJhbGciOiJSUzI1NiJ9...
\`\`\`

SDK 中间件自动取 token → 拉中台 JWKS 公钥 → 本地 RS256 验签 → 建本地用户 → 写 session → 跳 ${useRsa ? '/dashboard' : '/dashboard（或自定义）'}。

## 四、本地用户映射（可选）

默认 SDK 用 SSO user.sub 做唯一键。如要按 username 映射或自动建号，重写 \`_map_or_create_user\`：

\`\`\`python
from integration_hub.sso import middleware

def _map_or_create_user(user_info):
    # user_info 字段：sub, username, email, displayName, iss, aud
    from myapp.models import User
    user, _ = User.objects.get_or_create(
        sso_sub=user_info['sub'],
        defaults={'username': user_info['username'], 'email': user_info.get('email', '')},
    )
    return user

middleware._map_or_create_user = _map_or_create_user
\`\`\`

## 五、验证流程

1. 你装好 SDK + 挂好路由后通知中台
2. 中台在控制台 → 应用门户 → 点"${selectedApp.name}"的"打开"按钮
3. 浏览器新窗口应直接进入你的 /dashboard，不再跳 /login

## 六、问题排查

| 现象 | 根因 | 修复 |
|---|---|---|
| 浏览器打开 URL 是 /login 而非 /sso/callback | 中台 loginUrl 配错 | 中台改 loginUrl 为对方落地路由 |
| 对方报 JWKS unreachable | 中台未启动 / JWKS 端点 404 | curl ${platformUrl}/api/sso/.well-known/jwks.json 自检 |
| 对方报 aud mismatch | SDK audience 与应用 code 不一致 | 改 SDK configure(audience="${selectedApp.code}") |
| 对方报 token expired | token > 5 分钟才到对方 | 检查 jwtExpiresIn 与落地路由响应速度 |
| 对方建号失败 | _map_or_create_user 抛异常 | 检查本地 User 表是否有 sso_sub 字段 |
`;
    return guide;
  };

  const copyGuide = () => {
    const guide = buildIntegrationGuide();
    if (!guide) return;
    navigator.clipboard.writeText(guide).then(
      () => toast.success('对接清单已复制'),
      () => toast.error('复制失败'),
    );
  };

  const downloadGuide = () => {
    const guide = buildIntegrationGuide();
    if (!guide) return;
    const blob = new Blob([guide], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedApp?.code || 'app'}-sso-对接清单.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBuildSdk = async () => {
    setBuilding(true);
    try {
      const data = await openApi.buildSdk();
      setSdkData({ ...sdkData, builds: data.builds, latest: data.latest });
      toast.success(`构建成功：${data.latest?.filename || ''}`);
    } catch (error) {
      toast.error((error as Error).message || '构建失败');
    } finally {
      setBuilding(false);
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

        {/* 集成凭证（仅平台账号可见，含发放/编辑/轮换/删除） */}
        {isPlatform && canManage && (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" />
              集成凭证
              <Badge variant="secondary" className="ml-2 text-xs">置顶</Badge>
            </CardTitle>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              发放密钥
            </Button>
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
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        {/* SDK 构建下载 */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4 text-primary" />
              SDK 构建与下载
              {sdkData?.latest && (
                <Badge variant="outline" className="ml-2 font-mono text-xs">
                  v{sdkData.latest.version}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              {isPlatform && canManage && (
                <Button size="sm" variant="default" onClick={handleBuildSdk} disabled={building}>
                  {building ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Hammer className="mr-2 h-4 w-4" />
                  )}
                  {building ? '构建中...' : '构建最新包'}
                </Button>
              )}
              {sdkData?.latest && (
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                >
                  <a
                    href={openApi.downloadSdkUrl(sdkData.latest.filename)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    下载最新 wheel
                  </a>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium">安装命令</p>
              <code className="font-mono">
                pip install {sdkData?.latest?.filename || 'integration_hub-<version>-py3-none-any.whl'}
              </code>
            </div>
            {sdkData?.builds && sdkData.builds.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 font-medium">版本</th>
                      <th className="py-2 font-medium">类型</th>
                      <th className="py-2 font-medium">大小</th>
                      <th className="py-2 font-medium">构建时间</th>
                      <th className="py-2 font-medium">文件名</th>
                      <th className="py-2 font-medium text-right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sdkData.builds.map((b: any) => (
                      <tr key={b.filename} className="border-b last:border-0">
                        <td className="py-3 font-mono text-xs">v{b.version}</td>
                        <td className="py-3">
                          <Badge variant={b.kind === 'wheel' ? 'success' : 'secondary'} className="text-xs">
                            {b.kind === 'wheel' ? 'wheel' : 'sdist'}
                          </Badge>
                        </td>
                        <td className="py-3 text-xs text-muted-foreground">{b.sizeText}</td>
                        <td className="py-3 text-xs text-muted-foreground">
                          {new Date(b.mtime * 1000).toLocaleString('zh-CN')}
                        </td>
                        <td className="py-3 font-mono text-xs text-muted-foreground">{b.filename}</td>
                        <td className="py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            title={`下载 ${b.filename}`}
                            asChild
                          >
                            <a
                              href={openApi.downloadSdkUrl(b.filename)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  最多展示最近 10 次构建。点"构建最新包"会重新跑 <code className="font-mono">python -m build</code>，新版本会出现在列表顶部。
                </p>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                暂无构建产物。点击右上角"构建最新包"生成 wheel。
              </p>
            )}
          </CardContent>
        </Card>

        {/* 应用对接清单 */}
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              应用对接清单
            </CardTitle>
            <div className="flex gap-2">
              {selectedApp && (
                <>
                  <Button variant="outline" size="sm" onClick={copyGuide}>
                    <Copy className="mr-2 h-4 w-4" />
                    复制清单
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadGuide}>
                    <Download className="mr-2 h-4 w-4" />
                    下载 .md
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Label className="mb-2 block text-sm">选择应用</Label>
              <Select value={selectedAppId} onValueChange={handleSelectApp}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择一个应用查看对接信息" />
                </SelectTrigger>
                <SelectContent>
                  {apps.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}（{a.code}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedApp ? (
              <div className="space-y-4">
                <div className="rounded-md border p-4">
                  <p className="mb-3 text-sm font-medium">一、中台侧信息（直接复制给对方）</p>
                  <div className="grid gap-2 text-xs md:grid-cols-2">
                    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
                      <span className="text-muted-foreground">中台地址</span>
                      <code className="font-mono">{PLATFORM_ORIGIN}</code>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
                      <span className="text-muted-foreground">AppID</span>
                      <code className="font-mono">{selectedApp.id}</code>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
                      <span className="text-muted-foreground">Audience (code)</span>
                      <code className="font-mono">{selectedApp.code}</code>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
                      <span className="text-muted-foreground">验签模式</span>
                      <code className="font-mono">
                        {selectedApp.settings?.useRsa === true || selectedApp.settings?.useRsa === 'true' ? 'RS256' : 'HS256'}
                      </code>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
                      <span className="text-muted-foreground">JWKS 端点</span>
                      <code className="font-mono text-[10px]">
                        {API_BASE}/sso/.well-known/jwks.json
                      </code>
                    </div>
                    <div className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5">
                      <span className="text-muted-foreground">SDK wheel</span>
                      <code className="font-mono text-[10px]">
                        {sdkData?.latest?.filename || 'integration_hub-1.5.0-py3-none-any.whl'}
                      </code>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <p className="mb-3 text-sm font-medium">二、对方需要做的 3 件事</p>
                  <ol className="ml-4 list-decimal space-y-2 text-xs text-muted-foreground">
                    <li>
                      <span className="font-medium text-foreground">安装 SDK</span>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{`pip install ${sdkData?.latest?.filename || 'integration_hub-1.5.0-py3-none-any.whl'}`}</pre>
                    </li>
                    <li>
                      <span className="font-medium text-foreground">5 行配置（Django settings.py）</span>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs leading-5">{`from integration_hub.sso import configure
configure(
    platform_url="${PLATFORM_ORIGIN}",
    audience="${selectedApp.code}",
    app_id="${selectedApp.id}",
    auto_create_user=True,
    default_redirect="/dashboard",
)
MIDDLEWARE += ["integration_hub.sso.middleware.django_sso_callback"]`}</pre>
                    </li>
                    <li>
                      <span className="font-medium text-foreground">挂载落地路由（urls.py）</span>
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs">{`from integration_hub.sso.middleware import django_sso_callback_view
urlpatterns += [path("sso/callback", django_sso_callback_view)]`}</pre>
                    </li>
                  </ol>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                  <p className="mb-1 font-medium">⚠ 中台这一侧必须确认的配置</p>
                  <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
                    <li><code className="font-mono">loginUrl</code> = <code className="font-mono">{selectedApp.loginUrl || '(未配置，需指向对方 /sso/callback)'}</code></li>
                    <li><code className="font-mono">settings.useRsa</code> = <code className="font-mono">{String(selectedApp.settings?.useRsa === true || selectedApp.settings?.useRsa === 'true')}</code>（应为 true 才走 RS256）</li>
                    <li><code className="font-mono">jwtExpiresIn</code> = <code className="font-mono">{selectedApp.jwtExpiresIn ?? 300}</code> 秒</li>
                    <li><code className="font-mono">loginType</code> = <code className="font-mono">{selectedApp.loginType}</code>（应为 jwt）</li>
                  </ul>
                </div>
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                请先在应用管理创建应用
              </p>
            )}
          </CardContent>
        </Card>

        {/* 收纳区：类型目录 / 鉴权方式 / 服务状态 / 错误码 / 白标嵌入 */}
        <Tabs defaultValue="catalog" className="mb-6">
          <TabsList>
            <TabsTrigger value="catalog">类型目录</TabsTrigger>
            <TabsTrigger value="auth">鉴权方式</TabsTrigger>
            <TabsTrigger value="status">服务状态</TabsTrigger>
            <TabsTrigger value="errors">错误码 / Changelog</TabsTrigger>
            <TabsTrigger value="embed">白标嵌入</TabsTrigger>
            <TabsTrigger value="billing">账单与用量</TabsTrigger>
          </TabsList>
          <TabsContent value="catalog">
            <Card>
              <CardContent className="pt-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {types.map((item: any) => {
                    const Icon = TYPE_ICONS[item.code] || Plug;
                    return (
                      <div key={item.code} className="rounded-md border p-4">
                        <div className="mb-2 flex items-center gap-2 text-base font-medium">
                          <Icon className="h-4 w-4 text-primary" />
                          {item.name}
                        </div>
                        <p className="mb-2 text-sm text-muted-foreground">{item.description}</p>
                        <div className="space-y-1">
                          {(item.quickStart || []).slice(0, 3).map((step: string) => (
                            <p key={step} className="text-xs leading-5 text-muted-foreground">
                              {step}
                            </p>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="auth">
            <Card>
              <CardContent className="space-y-3 pt-6 text-sm">
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
          </TabsContent>
          <TabsContent value="status">
            <Card>
              <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
                <p>状态：{statusInfo?.status || '未知'} · 环境 {statusInfo?.environment || '-'} · 队列 {statusInfo?.queueBackend || '-'}</p>
                <p className="text-xs">
                  真实读写：{(statusInfo?.runtime?.extract || []).join('、') || '加载中'}
                </p>
                <p className="text-xs font-mono">GET /api/open/status · GET /api/open/openapi.json</p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="errors">
            <Card>
              <CardContent className="space-y-2 pt-6 text-xs text-muted-foreground">
                {(changelog[0]?.items || []).slice(0, 4).map((item: string) => (
                  <p key={item}>· {item}</p>
                ))}
                <p className="pt-1 font-mono">
                  GET /api/open/errors（{errors.length} 条） · GET /api/open/changelog
                </p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="embed">
            <div className="space-y-6">
              {/* 白标嵌入三步 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LayoutTemplate className="h-4 w-4 text-primary" />
                    白标嵌入 · 两步接入
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Step 1 — 集成商后端 */}
                  <div className="rounded-md border p-4">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">1</div>
                      <p className="text-sm font-semibold">后端生成签名 token（每次 iframe 加载）</p>
                      <Badge variant="secondary" className="text-xs">HMAC-SHA256 · 5 分钟有效</Badge>
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground">
                      签名密钥由平台预置到集成商的 IntegrationClient（<code className="font-mono">embed_token</code>，48 位十六进制，与 API Key 独立）。
                      集成商后端按下方算法生成 token，注入页面模板。
                    </p>
                    <EmbedAlgorithmBlock />
                  </div>

                  {/* Step 2 — 前端 iframe */}
                  <div className="rounded-md border p-4">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">2</div>
                      <p className="text-sm font-semibold">前端 iframe 嵌入</p>
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground">
                      把后端生成的 token 拼到 URL 上，嵌入端点自动按 clientId 拉取白标配置（logo/公司名/主色）。
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded bg-muted p-3">
                        <p className="mb-2 text-xs font-medium">SLA 状态卡</p>
                        <pre className="overflow-x-auto text-[11px] leading-5 font-mono">{`<iframe
  src="${API_BASE}/embed/sla?clientId=ic_xxx&token=1716000000.8f2a...&output=html"
  width="360" height="180" frameborder="0"
/>`}</pre>
                      </div>
                      <div className="rounded bg-muted p-3">
                        <p className="mb-2 text-xs font-medium">用量进度条</p>
                        <pre className="overflow-x-auto text-[11px] leading-5 font-mono">{`<iframe
  src="${API_BASE}/embed/usage?clientId=ic_xxx&token=1716000000.8f2a...&output=html"
  width="360" height="200" frameborder="0"
/>`}</pre>
                      </div>
                    </div>
                    <div className="mt-3 rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                      <p className="font-medium">品牌自定义（匿名）</p>
                      <p className="mt-1">
                        嵌入页自动调 <code className="font-mono">GET {API_BASE}/branding?clientId=ic_xxx</code> 获取 logo、公司名、主色。
                        平台侧在集成凭证里配置（<code className="font-mono">brandingLogoUrl</code>、<code className="font-mono">companyName</code>、<code className="font-mono">primaryColor</code> 等）。
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 服务端验证规则 + 路径汇总 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    服务端验证规则 · 端点汇总
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-md border p-4">
                    <p className="mb-2 text-sm font-medium">服务端验证规则</p>
                    <ul className="space-y-1.5 text-xs text-muted-foreground">
                      <li>· 用 <code className="font-mono">HMAC-SHA256</code> 重算签名，key = <code className="font-mono">client.embed_token</code></li>
                      <li>· 用 <code className="font-mono">hmac.compare_digest</code> constant-time 比较，防时序攻击</li>
                      <li>· 时间戳与服务端相差 ≤ <code className="font-mono">300</code> 秒（5 分钟）</li>
                      <li>· embed_token 泄露或轮换后，旧 token 立即全部失效</li>
                    </ul>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 font-medium">方法</th>
                          <th className="py-2 font-medium">路径</th>
                          <th className="py-2 font-medium">鉴权</th>
                          <th className="py-2 font-medium">说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['POST', '/api/embed/token', 'API Key', '重置 embed_token + 返回示例签名'],
                          ['GET', '/api/branding', '匿名', '白标配置（logo / 公司名 / 颜色）'],
                          ['GET', '/api/status', '匿名', '平台 / Client SLA 状态'],
                          ['GET', '/api/embed/sla', 'EmbedToken', '嵌入页 SLA 卡片'],
                          ['GET', '/api/embed/usage', 'EmbedToken', '嵌入页用量进度条'],
                        ].map(([method, path, auth, desc]) => (
                          <tr key={path} className="border-b last:border-0">
                            <td className="py-2 font-mono">
                              <Badge variant={method === 'GET' ? 'outline' : 'default'} className="text-[10px]">{method}</Badge>
                            </td>
                            <td className="py-2 font-mono">{path}</td>
                            <td className="py-2">
                              <Badge variant={auth === '匿名' ? 'secondary' : 'outline'} className="text-[10px]">{auth}</Badge>
                            </td>
                            <td className="py-2 text-muted-foreground">{desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="billing">
            <BillingTab isPlatform={isPlatform} canManage={canManage} />
          </TabsContent>
        </Tabs>

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
