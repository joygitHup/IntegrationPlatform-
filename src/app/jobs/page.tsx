'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { jobsApi, datasourcesApi, openApi, connectorsApi } from '@/lib/api-client';
import { OrgTreePanel } from '@/components/org-tree';
import { DagCanvas } from '@/components/dag-canvas';
import { parseDagSteps, stringifyDagSteps } from '@/lib/dag';
import {
  DESENSITIZE_OPTIONS,
  TRANSFORM_OPTIONS,
  defaultMapping,
  emptyJobForm,
  buildJobPayload,
  formFromJobDetail,
  suggestJobCode,
  validateJobForm,
  connectorSupportsIncremental,
  connectorSupportsUpsert,
  type FieldMapping,
} from '@/lib/job-form';
import { resolveConnectorList } from '@/lib/datasource-form';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  GitBranch,
  Plus,
  Search,
  PlayCircle,
  PauseCircle,
  StopCircle,
  Play,
  Edit,
  Trash2,
  Loader2,
  ArrowRightLeft,
  Clock,
  Database,
  Zap,
  Settings,
  X,
  GripVertical,
  PlusCircle,
  Trash,
  Save,
  AlertCircle,
  RefreshCw,
  Activity,
  CheckCircle2,
  XCircle,
  Users,
  Network,
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  running: { label: '运行中', variant: 'success' },
  stopped: { label: '已停止', variant: 'secondary' },
  paused: { label: '已暂停', variant: 'warning' },
  error: { label: '异常', variant: 'destructive' },
};

const SYNC_MODE_MAP: Record<string, string> = {
  full: '全量同步',
  incremental: '增量同步',
};

const IDENTITY_TYPES = new Set(['dingtalk', 'wecom', 'ldap', 'active_directory']);

const SCHEDULE_TYPE_MAP: Record<string, string> = {
  manual: '手动触发',
  cron: '定时调度',
  event: '事件触发',
  webhook: 'Webhook',
};

export default function JobsPage() {
  const { hasPermission } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [orgJob, setOrgJob] = useState<any | null>(null);

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [form, setForm] = useState({ ...emptyJobForm, fieldMapping: [{ ...defaultMapping }] });
  const [codeTouched, setCodeTouched] = useState(false);
  const [datasourceList, setDatasourceList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('basic');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // 编辑模式下当前任务的水位线值（纯展示 + 重置）
  const [currentJobWatermark, setCurrentJobWatermark] = useState<{ value: string; last: string } | null>(null);
  const [resettingWm, setResettingWm] = useState(false);
  const [resetWmInput, setResetWmInput] = useState('');
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [inspectedTables, setInspectedTables] = useState<string[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [promoteId, setPromoteId] = useState<string | null>(null);
  const [partners, setPartners] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [connectors, setConnectors] = useState<any[]>([]);

  const canWrite = hasPermission('job:write');
  const canExecute = hasPermission('job:execute');
  const sourceConnector = connectors.find(
    (c) => c.type === datasourceList.find((d) => d.id === form.sourceDatasourceId)?.type,
  );
  const sourceAllowsIncremental = connectorSupportsIncremental(sourceConnector);
  const targetConnector = connectors.find(
    (c) => c.type === datasourceList.find((d) => d.id === form.targetDatasourceId)?.type,
  );
  const targetAllowsUpsert = connectorSupportsUpsert(targetConnector);

  useEffect(() => {
    if (!targetAllowsUpsert && (form.writeMode === 'upsert' || form.writeMode === 'update_only')) {
      setForm((prev) => ({ ...prev, writeMode: 'insert' }));
    }
  }, [targetAllowsUpsert, form.writeMode]);

  useEffect(() => {
    loadJobs();
    loadDatasources();
    if (hasPermission('open:manage')) {
      openApi.clients.list().then((r) => setPartners(r.items || [])).catch(() => setPartners([]));
    }
    openApi.templates().then((r) => setTemplates(r.items || [])).catch(() => setTemplates([]));
    connectorsApi.list().then((r) => setConnectors(resolveConnectorList(r))).catch(() => setConnectors([]));
  }, [status, hasPermission]);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { pageSize: 100 };
      if (status) params.status = status;
      if (keyword) params.keyword = keyword;
      const result = await jobsApi.list(params);
      setJobs(result.items || []);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadDatasources = async () => {
    try {
      const result = await datasourcesApi.list({ pageSize: 100, status: 'active' });
      setDatasourceList(result.items || []);
    } catch (error) {
      console.error('Failed to load datasources:', error);
    }
  };

  const applySyncTemplate = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) {
      setForm({ ...form, templateType: '' });
      return;
    }
    const mappings = (tpl.fieldMappings || []).map((m: any) => {
      let transform = m.transform || '';
      if (transform === 'none') transform = '';
      if (transform === 'to_date') transform = 'toDate';
      return {
        source: m.source || '',
        target: m.target || '',
        transform,
        defaultValue: m.defaultValue || '',
        required: Boolean(m.required),
        params: m.params && typeof m.params === 'object' ? m.params : undefined,
      };
    });
    const sm = tpl.statusMapping;
    if (sm?.sourceField && sm?.targetField && Array.isArray(sm.rules) && sm.rules.length) {
      const extra = {
        source: sm.sourceField,
        target: sm.targetField,
        transform: 'statusMap',
        defaultValue: '',
        required: false,
        params: { rules: sm.rules },
      };
      const idx = mappings.findIndex((m: FieldMapping) => m.target === extra.target);
      if (idx >= 0) mappings[idx] = { ...mappings[idx], ...extra };
      else mappings.push(extra);
    }
    setForm({
      ...form,
      templateType: tpl.id,
      matchKeys: (tpl.defaultMatchKeys || []).join(','),
      sensitiveFields: (tpl.defaultSensitiveFields || []).join(','),
      fieldMapping: mappings.length ? mappings : form.fieldMapping,
    });
    toast.success(`已套用「${tpl.name}」`);
  };

  const openCreate = () => {
    setEditingId(null);
    setCodeTouched(false);
    setForm({ ...emptyJobForm, fieldMapping: [{ ...defaultMapping }] });
    setFormErrors({});
    setSourceColumns([]);
    setInspectedTables([]);
    setPreviewRows(null);
    setActiveTab('basic');
    setDialogOpen(true);
  };

  const openEdit = async (job: any) => {
    setEditingId(job.id);
    setCodeTouched(true);
    setDialogLoading(true);
    setDialogOpen(true);
    setCurrentJobWatermark(null);
    try {
      const detail = await jobsApi.get(job.id);
      setForm(formFromJobDetail(detail));
      setFormErrors({});
      setInspectedTables([]);
      setSourceColumns([]);
      setActiveTab('basic');
      setCurrentJobWatermark({
        value: detail.watermarkValue || '',
        last: detail.lastWatermarkValue || '',
      });
      setResetWmInput('');
    } catch (error) {
      toast.error((error as Error).message);
      setDialogOpen(false);
    } finally {
      setDialogLoading(false);
    }
  };

  const handleResetWatermark = async (value?: string) => {
    if (!editingId) return;
    // 显式传值优先（"清空"按钮传空串），否则读输入框
    const target = value !== undefined ? value : resetWmInput.trim();
    setResettingWm(true);
    try {
      const result = await jobsApi.resetWatermark(editingId, target || null);
      setCurrentJobWatermark({
        value: result.watermarkValue || '',
        last: result.lastWatermarkValue || '',
      });
      toast.success(
        result.watermarkValue
          ? `水位线已设为 ${result.watermarkValue}`
          : '水位线已清空，下次执行等价全量同步'
      );
      setResetWmInput('');
    } catch (error) {
      toast.error((error as Error).message || '重置水位线失败');
    } finally {
      setResettingWm(false);
    }
  };

  const handleSubmit = async () => {
    const { errors, tab } = validateJobForm(form);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      setActiveTab(tab);
      toast.error('请检查表单填写');
      return;
    }

    setDialogLoading(true);
    try {
      const payload = buildJobPayload(form);
      if (editingId) {
        await jobsApi.update(editingId, payload);
        toast.success('任务更新成功');
      } else {
        await jobsApi.create(payload);
        toast.success('任务创建成功');
      }
      setDialogOpen(false);
      loadJobs();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDialogLoading(false);
    }
  };

  const handleTrigger = async (id: string) => {
    setTriggeringId(id);
    try {
      const result = await jobsApi.trigger(id);
      toast.success('任务已触发', { description: `执行ID: ${result.executionId?.slice(0, 12) || ''}...` });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setTriggeringId(null);
    }
  };

  const handleIdentityPull = async (job: any) => {
    setPullingId(job.id);
    try {
      const result = await openApi.identity.pull({
        datasourceId: job.sourceDatasourceId,
        jobId: job.id,
        syncOrg: true,
        executeJob: true,
      });
      const execId = result.execution?.executionId || result.execution?.id;
      toast.success(
        `已拉取 ${result.userCount ?? 0} 名用户、${result.departmentCount ?? 0} 个部门，并写入目标`,
        execId ? { description: `执行ID: ${String(execId).slice(0, 12)}...` } : undefined,
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPullingId(null);
    }
  };

  const handleControl = async (id: string, action: 'start' | 'stop' | 'pause') => {
    try {
      await jobsApi.control(id, action);
      toast.success(`已${action === 'start' ? '启动' : action === 'stop' ? '停止' : '暂停'}任务`);
      loadJobs();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await jobsApi.delete(deleteId);
      toast.success('删除成功');
      loadJobs();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  const addMapping = () => {
    setForm({ ...form, fieldMapping: [...form.fieldMapping, { ...defaultMapping }] });
  };

  const removeMapping = (index: number) => {
    const newMappings = form.fieldMapping.filter((_, i) => i !== index);
    setForm({ ...form, fieldMapping: newMappings.length > 0 ? newMappings : [{ ...defaultMapping }] });
  };

  const updateMapping = (index: number, key: keyof FieldMapping, value: any) => {
    const newMappings = [...form.fieldMapping];
    newMappings[index] = { ...newMappings[index], [key]: value };
    setForm({ ...form, fieldMapping: newMappings });
  };

  const inspectSource = async () => {
    if (!form.sourceDatasourceId) {
      toast.error('请先选择源数据源');
      return;
    }
    setInspectLoading(true);
    try {
      const result = await datasourcesApi.inspect({
        id: form.sourceDatasourceId,
        table: form.sourceTable || undefined,
      });
      const tableNames = (result.tables || [])
        .map((t: any) => (typeof t === 'string' ? t : t?.name))
        .filter(Boolean);
      setInspectedTables(tableNames);
      const cols = (result.columns || []).map((c: any) => c.name).filter(Boolean);
      setSourceColumns(cols);
      if (!form.sourceTable && tableNames.length === 1) {
        setForm((prev) => ({ ...prev, sourceTable: tableNames[0] }));
      }
      if (cols.length && form.fieldMapping.every((m) => !m.source && !m.target)) {
        setForm((prev) => ({
          ...prev,
          fieldMapping: cols.slice(0, 12).map((name: string) => ({
            ...defaultMapping,
            source: name,
            target: name,
          })),
        }));
      }
      const hint = result.message || (cols.length ? `探测到 ${cols.length} 个字段` : tableNames.length ? `探测到 ${tableNames.length} 个 Topic/队列/表` : '已探测，请填写表名后再试');
      toast.success(hint);
      // 水位线字段建议：探测返回 suggestedWatermarkField 时，若当前是 incremental 且 watermarkField 空 → 自动填入
      const suggested = result.suggestedWatermarkField as string | undefined;
      if (suggested && form.syncMode === 'incremental' && !form.watermarkField.trim()) {
        setForm((prev) => ({ ...prev, watermarkField: suggested! }));
        toast.info(`已自动推荐水位字段: ${suggested}`);
      }
    } catch (error) {
      toast.error((error as Error).message || '探测失败');
    } finally {
      setInspectLoading(false);
    }
  };

  const previewMapping = async () => {
    if (!form.sourceDatasourceId) {
      toast.error('请先选择源数据源');
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await jobsApi.preview({
        datasourceId: form.sourceDatasourceId,
        table: form.sourceTable || undefined,
        fieldMapping: form.fieldMapping.filter((m) => m.source.trim() && m.target.trim()),
        filterCondition: form.filterCondition.trim() || undefined,
        limit: 20,
      });
      setPreviewRows(result.preview || result.sample || []);
      const cols = result.columns || [];
      if (cols.length) setSourceColumns(cols);
      if (result.mapping && result.mapping.valid === false) {
        toast.error((result.mapping.errors || []).join('；') || '映射校验失败');
      } else {
        toast.success('已生成映射预览');
      }
    } catch (error) {
      toast.error((error as Error).message || '预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteId) return;
    try {
      await openApi.promote({ jobId: promoteId, targetEnvironment: 'prod' });
      toast.success('已复制到生产环境（新任务默认停止）');
      setPromoteId(null);
      loadJobs();
    } catch (error) {
      toast.error((error as Error).message || '晋升失败');
    }
  };

  const getDatasourceName = (id: string) => {
    const ds = datasourceList.find((d) => d.id === id);
    return ds ? ds.name : id?.slice(0, 8) || '-';
  };

  const isIdentityJob = (job: any) => {
    const ds = datasourceList.find((d) => d.id === job.sourceDatasourceId);
    return ds ? IDENTITY_TYPES.has(String(ds.type || '').toLowerCase()) : false;
  };

  const stats = {
    total: jobs.length,
    running: jobs.filter((j) => j.status === 'running').length,
    stopped: jobs.filter((j) => j.status === 'stopped').length,
    error: jobs.filter((j) => j.status === 'error').length,
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">集成任务</h1>
            <p className="text-sm text-muted-foreground">管理数据集成任务的配置与调度</p>
          </div>
          {canWrite && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              新建任务
            </Button>
          )}
        </div>

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">任务总数</p>
                <p className="text-2xl font-semibold">{stats.total}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <GitBranch className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">运行中</p>
                <p className="text-2xl font-semibold text-green-600">{stats.running}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-600">
                <Activity className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">已停止</p>
                <p className="text-2xl font-semibold">{stats.stopped}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                <StopCircle className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">异常</p>
                <p className="text-2xl font-semibold text-red-600">{stats.error}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <AlertCircle className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 筛选 */}
        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索任务名称或编码..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && loadJobs()}
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_MAP).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={loadJobs}>
              <RefreshCw className="mr-2 h-4 w-4" />
              搜索
            </Button>
          </CardContent>
        </Card>

        {/* 列表 */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">共 {jobs.length} 个任务</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="py-16 text-center">
                <GitBranch className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">暂无集成任务</p>
                {canWrite && (
                  <Button variant="outline" className="mt-4" onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    新建第一个任务
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">任务名称</th>
                      <th className="px-4 py-3 text-left font-medium">数据流向</th>
                      <th className="px-4 py-3 text-left font-medium">同步方式</th>
                      <th className="px-4 py-3 text-left font-medium">调度方式</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">水位值</th>
                      <th className="px-4 py-3 text-left font-medium">创建时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => {
                      const statusInfo = STATUS_MAP[job.status] || { label: job.status, variant: 'secondary' };
                      return (
                        <tr key={job.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                                <GitBranch className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-medium">{job.name}</p>
                                <p className="font-mono text-xs text-muted-foreground">{job.code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            <span>{getDatasourceName(job.sourceDatasourceId)}</span>
                            <span className="mx-1">→</span>
                            <span>{getDatasourceName(job.targetDatasourceId)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <ArrowRightLeft className="h-3 w-3" />
                              <span>{SYNC_MODE_MAP[job.syncMode] || job.syncMode}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {job.scheduleType === 'cron' && job.scheduleCron ? (
                              <code className="rounded bg-muted px-1.5 py-0.5">{job.scheduleCron}</code>
                            ) : job.scheduleType === 'event' && job.scheduleCron ? (
                              <span>事件 {job.scheduleCron}</span>
                            ) : (
                              SCHEDULE_TYPE_MAP[job.scheduleType] || job.scheduleType
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusInfo.variant as any}>{statusInfo.label}</Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {job.watermarkValue || '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(job.createdAt).toLocaleString('zh-CN')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canExecute && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2 text-green-600 hover:text-green-600"
                                  onClick={() => handleTrigger(job.id)}
                                  disabled={triggeringId === job.id}
                                  title="立即执行"
                                >
                                  {triggeringId === job.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Play className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                              {canExecute && isIdentityJob(job) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => handleIdentityPull(job)}
                                  disabled={pullingId === job.id}
                                  title="从钉钉/企微/AD 拉取通讯录"
                                >
                                  {pullingId === job.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Users className="h-4 w-4" />
                                  )}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => setOrgJob(job)}
                                title="查看组织架构树"
                              >
                                <Network className="h-4 w-4" />
                              </Button>
                              { (job.scheduleType === 'cron' || job.scheduleType === 'event' || job.scheduleType === 'webhook') && canWrite && (
                                <>
                                  {job.status !== 'running' && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => handleControl(job.id, 'start')}
                                      title={
                                        job.status === 'paused'
                                          ? (job.scheduleType === 'webhook' ? '恢复接收' : job.scheduleType === 'event' ? '恢复事件监听' : '恢复调度')
                                          : (job.scheduleType === 'webhook' ? '启动接收' : job.scheduleType === 'event' ? '启动事件监听' : '启动调度')
                                      }
                                    >
                                      <PlayCircle className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {job.status === 'running' && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => handleControl(job.id, 'pause')}
                                      title={job.scheduleType === 'webhook' ? '暂停接收' : job.scheduleType === 'event' ? '暂停事件监听' : '暂停调度'}
                                    >
                                      <PauseCircle className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {(job.status === 'running' || job.status === 'paused') && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => handleControl(job.id, 'stop')}
                                      title={job.scheduleType === 'webhook' ? '停止接收' : job.scheduleType === 'event' ? '停止事件监听' : '停止调度'}
                                    >
                                      <StopCircle className="h-4 w-4" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {canWrite && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={() => openEdit(job)}
                                    title="编辑"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  {job.environment !== 'prod' && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => setPromoteId(job.id)}
                                      title="晋升到生产"
                                    >
                                      <GitBranch className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteId(job.id)}
                                    title="删除"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
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
          </CardContent>
        </Card>
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑任务' : '新建集成任务'}</DialogTitle>
            <DialogDescription>
              配置任务的数据源、字段映射和调度策略
            </DialogDescription>
          </DialogHeader>

          {dialogLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
                <TabsList className="mx-4">
                  <TabsTrigger value="basic">基本信息</TabsTrigger>
                  <TabsTrigger value="mapping">字段映射</TabsTrigger>
                  <TabsTrigger value="schedule">调度配置</TabsTrigger>
                  <TabsTrigger value="dag">DAG 编排</TabsTrigger>
                  <TabsTrigger value="advanced">高级设置</TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {/* 基本信息 */}
                  <TabsContent value="basic" className="mt-0 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>任务名称 <span className="text-destructive">*</span></Label>
                        <Input
                          placeholder="如：用户数据同步"
                          value={form.name}
                          onChange={(e) => {
                            const name = e.target.value;
                            setForm((prev) => ({
                              ...prev,
                              name,
                              code: codeTouched || editingId ? prev.code : (name ? suggestJobCode(name) : ''),
                            }));
                            if (formErrors.name) setFormErrors({ ...formErrors, name: '' });
                          }}
                          className={formErrors.name ? 'border-destructive' : ''}
                        />
                        {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>任务编码 <span className="text-destructive">*</span></Label>
                        <Input
                          placeholder="如：user_sync_01"
                          value={form.code}
                          onChange={(e) => {
                            setCodeTouched(true);
                            setForm({ ...form, code: e.target.value });
                            if (formErrors.code) setFormErrors({ ...formErrors, code: '' });
                          }}
                          className={formErrors.code ? 'border-destructive' : ''}
                          disabled={!!editingId}
                        />
                        {formErrors.code && <p className="text-xs text-destructive">{formErrors.code}</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>任务描述</Label>
                      <Textarea
                        placeholder="简要描述任务用途..."
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        rows={2}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                          <Database className="h-3.5 w-3.5 text-green-600" />
                          源数据源 {form.scheduleType !== 'webhook' && <span className="text-destructive">*</span>}
                        </Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={form.sourceDatasourceId}
                          onChange={(e) => {
                            const id = e.target.value;
                            const ds = datasourceList.find((d) => d.id === id);
                            const meta = connectors.find((c) => c.type === ds?.type);
                            const ok = connectorSupportsIncremental(meta);
                            setForm({
                              ...form,
                              sourceDatasourceId: id,
                              syncMode: ok ? form.syncMode : 'full',
                              watermarkField: ok ? form.watermarkField : '',
                            });
                          }}
                        >
                          <option value="">{form.scheduleType === 'webhook' ? 'Webhook 推数可不选源' : '请选择源数据源'}</option>
                          {datasourceList.map((ds) => (
                            <option key={ds.id} value={ds.id}>{ds.name} ({ds.type})</option>
                          ))}
                        </select>
                        {formErrors.sourceDatasourceId && <p className="text-xs text-destructive">{formErrors.sourceDatasourceId}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label className="flex items-center gap-1">
                          <Database className="h-3.5 w-3.5 text-blue-600" />
                          目标数据源 <span className="text-destructive">*</span>
                        </Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={form.targetDatasourceId}
                          onChange={(e) => {
                            const id = e.target.value;
                            const ds = datasourceList.find((d) => d.id === id);
                            const meta = connectors.find((c) => c.type === ds?.type);
                            const ok = connectorSupportsUpsert(meta);
                            setForm({
                              ...form,
                              targetDatasourceId: id,
                              writeMode: ok ? form.writeMode : 'insert',
                            });
                          }}
                        >
                          <option value="">请选择目标数据源</option>
                          {datasourceList.filter((ds) => !IDENTITY_TYPES.has(ds.type)).map((ds) => (
                            <option key={ds.id} value={ds.id}>{ds.name} ({ds.type})</option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">钉钉 / 企微 / AD / LDAP 只能当源，目标请用库表、HTTP 或 SCIM。</p>
                        {formErrors.targetDatasourceId && <p className="text-xs text-destructive">{formErrors.targetDatasourceId}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>源表/路径</Label>
                        <Input
                          list="source-table-options"
                          placeholder="如：users、topic 或队列名，可先点探测"
                          value={form.sourceTable}
                          onChange={(e) => setForm({ ...form, sourceTable: e.target.value })}
                        />
                        <datalist id="source-table-options">
                          {inspectedTables.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                      </div>
                      <div className="space-y-2">
                        <Label>目标表/路径</Label>
                        <Input
                          placeholder="如：user_info 或 /api/import"
                          value={form.targetTable}
                          onChange={(e) => setForm({ ...form, targetTable: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>同步模式</Label>
                      <div className="flex gap-4">
                        {Object.entries(SYNC_MODE_MAP).map(([key, label]) => {
                          const disabled = key === 'incremental' && !sourceAllowsIncremental;
                          return (
                          <label key={key} className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                            <input
                              type="radio"
                              name="syncMode"
                              value={key}
                              checked={form.syncMode === key}
                              disabled={disabled}
                              onChange={(e) => setForm({ ...form, syncMode: e.target.value })}
                              className="h-4 w-4"
                            />
                            <span className="text-sm">{label}</span>
                          </label>
                          );
                        })}
                      </div>
                      {!sourceAllowsIncremental && (
                        <p className="text-xs text-muted-foreground">当前源连接器不支持增量，仅可全量同步。</p>
                      )}
                    </div>

                    {form.syncMode === 'incremental' && (
                      <div className="space-y-3 rounded-lg bg-blue-50/50 p-4 border border-blue-100">
                        <div className="space-y-2">
                          <Label className="text-blue-700">水位字段（增量同步基准）</Label>
                          <Input
                            placeholder="如：updated_at / id"
                            value={form.watermarkField}
                            onChange={(e) => setForm({ ...form, watermarkField: e.target.value })}
                            className={formErrors.watermarkField ? 'border-destructive' : ''}
                          />
                          {formErrors.watermarkField && <p className="text-xs text-destructive">{formErrors.watermarkField}</p>}
                          <p className="text-xs text-blue-600">
                            每次同步后记录该字段最大值，下一次仅同步大于该值的数据。探测源结构可自动推荐。
                          </p>
                        </div>

                        {/* 编辑模式下：当前水位线展示 + 手动重置 */}
                        {editingId && currentJobWatermark && (
                          <div className="space-y-2 rounded-md border border-blue-200 bg-white/70 p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-blue-800">当前水位线值</span>
                              {currentJobWatermark.value ? (
                                <code className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                                  {currentJobWatermark.value}
                                </code>
                              ) : (
                                <span className="text-xs text-muted-foreground">（尚未记录，首次运行将全量同步）</span>
                              )}
                            </div>
                            {currentJobWatermark.last && (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">上一次水位线（回滚参考）</span>
                                <code className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
                                  {currentJobWatermark.last}
                                </code>
                              </div>
                            )}
                            <div className="flex items-end gap-2 pt-1">
                              <div className="flex-1">
                                <Input
                                  placeholder="输入目标值，留空则清空水位线（下次等价全量）"
                                  value={resetWmInput}
                                  onChange={(e) => setResetWmInput(e.target.value)}
                                  className="h-8 text-xs"
                                />
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleResetWatermark()}
                                disabled={resettingWm}
                                className="h-8 text-xs"
                              >
                                {resettingWm ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                应用
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setResetWmInput('');
                                  handleResetWatermark('');
                                }}
                                disabled={resettingWm || !currentJobWatermark.value}
                                className="h-8 text-xs border-destructive text-destructive hover:bg-destructive/5"
                                title="清空水位线，下次运行将全量同步"
                              >
                                清空
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* 字段映射 */}
                  <TabsContent value="mapping" className="mt-0 space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground">
                        配置源字段到目标字段的映射关系。可先探测源表结构，再预览转换结果。
                      </p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={inspectSource} disabled={inspectLoading}>
                          {inspectLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Database className="mr-2 h-3.5 w-3.5" />}
                          探测字段
                        </Button>
                        <Button variant="outline" size="sm" onClick={previewMapping} disabled={previewLoading}>
                          {previewLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-2 h-3.5 w-3.5" />}
                          预览映射
                        </Button>
                      <Button variant="outline" size="sm" onClick={addMapping}>
                        <PlusCircle className="mr-2 h-3.5 w-3.5" />
                        添加字段
                      </Button>
                      </div>
                    </div>

                    {templates.length > 0 && (
                      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                        <Label>用户同步模板</Label>
                        <select
                          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={form.templateType || ''}
                          onChange={(e) => applySyncTemplate(e.target.value)}
                        >
                          <option value="">不使用模板，自行配置映射</option>
                          {templates.map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>
                              {tpl.name}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          套用后会覆盖字段映射（含状态映射）、匹配键和敏感字段，可再手动调整。
                        </p>
                      </div>
                    )}

                    {formErrors.fieldMapping && (
                      <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                        {formErrors.fieldMapping}
                      </div>
                    )}

                    <div className="rounded-lg border">
                      <div className="grid grid-cols-12 gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                        <div className="col-span-1"></div>
                        <div className="col-span-3">源字段</div>
                        <div className="col-span-3">目标字段</div>
                        <div className="col-span-2">转换方式</div>
                        <div className="col-span-2">默认值</div>
                        <div className="col-span-1 text-right">操作</div>
                      </div>
                      <div className="divide-y max-h-72 overflow-y-auto">
                        {form.fieldMapping.map((mapping, index) => (
                          <div key={index} className="space-y-2 px-3 py-2">
                          <div className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-1 text-muted-foreground">
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <div className="col-span-3">
                              {sourceColumns.length > 0 ? (
                                <select
                                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                  value={mapping.source}
                                  onChange={(e) => updateMapping(index, 'source', e.target.value)}
                                >
                                  <option value="">选择源字段</option>
                                  {sourceColumns.map((col) => (
                                    <option key={col} value={col}>{col}</option>
                                  ))}
                                </select>
                              ) : (
                              <Input
                                size={1}
                                placeholder="source_field"
                                value={mapping.source}
                                onChange={(e) => updateMapping(index, 'source', e.target.value)}
                                className="h-8 text-xs"
                              />
                              )}
                            </div>
                            <div className="col-span-3">
                              <Input
                                placeholder="target_field"
                                value={mapping.target}
                                onChange={(e) => updateMapping(index, 'target', e.target.value)}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="col-span-2">
                              <select
                                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                value={mapping.transform}
                                onChange={(e) => updateMapping(index, 'transform', e.target.value)}
                              >
                                {TRANSFORM_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <Input
                                placeholder="默认值"
                                value={mapping.defaultValue}
                                onChange={(e) => updateMapping(index, 'defaultValue', e.target.value)}
                                className="h-8 text-xs"
                                disabled={mapping.transform !== 'defaultValue' && !mapping.required}
                              />
                            </div>
                            <div className="col-span-1 flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeMapping(index)}
                                disabled={form.fieldMapping.length === 1}
                              >
                                <Trash className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          {mapping.transform === 'custom' && (
                            <Input
                              placeholder="表达式，变量名为 value，例如 str(value).upper() 或 value + '_ok'"
                              value={String(mapping.params?.expression || '')}
                              onChange={(e) => updateMapping(index, 'params', { ...(mapping.params || {}), expression: e.target.value })}
                              className="h-8 text-xs font-mono"
                            />
                          )}
                          {mapping.transform === 'statusMap' && Array.isArray(mapping.params?.rules) && (
                            <p className="text-xs text-muted-foreground">
                              状态映射：{(mapping.params.rules as Array<{ from?: unknown; to?: unknown; label?: string }>).map((r) => `${r.label || r.from}→${String(r.to)}`).join('，')}
                            </p>
                          )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {previewRows && previewRows.length > 0 && (
                      <div className="rounded-lg border p-3 text-xs">
                        <p className="mb-2 font-medium">映射预览（最多 5 行）</p>
                        <pre className="max-h-48 overflow-auto rounded bg-muted p-2 leading-5">
                          {JSON.stringify(previewRows, null, 2)}
                        </pre>
                      </div>
                    )}

                    <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                      <p className="font-medium">💡 转换说明</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li><strong>直接映射</strong>：源字段值原样写入目标字段</li>
                        <li><strong>trim / upper / lower</strong>：字符串处理</li>
                        <li><strong>toInt / toFloat / toString / toDate</strong>：类型转换</li>
                        <li><strong>默认值填充</strong>：源字段为空时使用默认值</li>
                        <li><strong>状态映射</strong>：按模板规则转换启用/禁用等状态码</li>
                      </ul>
                    </div>
                  </TabsContent>

                  {/* 调度配置 */}
                  <TabsContent value="schedule" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label>调度方式</Label>
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { key: 'manual', label: '手动触发', icon: Play, desc: '手动点击执行' },
                          { key: 'cron', label: '定时调度', icon: Clock, desc: '按 Cron 表达式' },
                          { key: 'event', label: '事件触发', icon: Zap, desc: '监听事件触发' },
                          { key: 'webhook', label: 'Webhook', icon: Settings, desc: '外部调用触发' },
                        ].map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.key}
                              type="button"
                              className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-left transition-all ${
                                form.scheduleType === item.key
                                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                                  : 'border-border hover:border-muted-foreground/50'
                              }`}
                              onClick={() => {
                                const next = { ...form, scheduleType: item.key };
                                if (item.key === 'event' && (form.scheduleCron.includes(' ') || !form.scheduleCron.trim())) {
                                  next.scheduleCron = 'job.completed';
                                }
                                if (item.key === 'cron' && !form.scheduleCron.includes(' ')) {
                                  next.scheduleCron = '0 */5 * * * *';
                                }
                                setForm(next);
                              }}
                            >
                              <Icon className="h-5 w-5" />
                              <div className="text-sm font-medium">{item.label}</div>
                              <div className="text-xs text-muted-foreground">{item.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {form.scheduleType === 'cron' && (
                      <div className="space-y-2 rounded-lg bg-blue-50/50 p-4 border border-blue-100">
                        <Label className="text-blue-700">Cron 表达式</Label>
                        <Input
                          placeholder="0 */5 * * * *"
                          value={form.scheduleCron}
                          onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
                          className={`font-mono ${formErrors.scheduleCron ? 'border-destructive' : ''}`}
                        />
                        {formErrors.scheduleCron && <p className="text-xs text-destructive">{formErrors.scheduleCron}</p>}
                        <p className="text-xs text-blue-600">
                          5 段（分 时 日 月 周）或 6 段（秒 分 时 日 月 周）。支持 <code className="bg-blue-100 px-1 rounded">*</code>、
                          <code className="bg-blue-100 px-1 rounded">*/5</code>、<code className="bg-blue-100 px-1 rounded">1-5</code>、
                          <code className="bg-blue-100 px-1 rounded">1,15</code>、<code className="bg-blue-100 px-1 rounded">MON-FRI</code>。
                          示例：<code className="bg-blue-100 px-1 rounded">0 2 * * 1-5</code> 表示工作日凌晨 2 点
                        </p>
                      </div>
                    )}

                    {form.scheduleType === 'event' && (
                      <div className="space-y-2 rounded-lg bg-amber-50/60 p-4 border border-amber-100">
                        <Label className="text-amber-800">监听事件</Label>
                        <Input
                          placeholder="job.completed"
                          value={form.scheduleCron}
                          onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
                          className={`font-mono ${formErrors.scheduleCron ? 'border-destructive' : ''}`}
                        />
                        {formErrors.scheduleCron && <p className="text-xs text-destructive">{formErrors.scheduleCron}</p>}
                        <p className="text-xs text-amber-800">
                          任务必须为「运行中」。新建默认停止，请先在列表点启动。其它任务结束后会发出 <code className="rounded bg-amber-100 px-1">job.completed</code>
                          、<code className="rounded bg-amber-100 px-1">job.completed.任务编码</code>。也可填 <code className="rounded bg-amber-100 px-1">*</code> 监听全部完成事件。
                        </p>
                      </div>
                    )}

                    {form.scheduleType === 'webhook' && (
                      <div className="space-y-2 rounded-lg bg-muted/50 p-4 border">
                        <Label>入站地址</Label>
                        <p className="font-mono text-xs break-all">
                          POST {(process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api').replace(/\/+$/, '')}/open/hooks/{form.code || '{code}'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          带 records body 会跳过 Extract 直接进 Transform → Load；不带 records 走正常 ETL 管道。
                        </p>
                        <div className="pt-2 space-y-1">
                          <Label htmlFor="webhookSecret" className="text-xs">Webhook Secret（生产必配，用于 HMAC 签名防重放）</Label>
                          <Input
                            id="webhookSecret"
                            placeholder="留空则允许匿名触发（不安全）"
                            value={form.webhookSecret}
                            onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                          />
                        </div>
                        {form.webhookSecret ? (
                          <p className="text-xs text-muted-foreground">
                            签名头：<span className="font-mono">{'X-Hub-Signature-256: sha256={HMAC(secret, "{timestamp}.{raw_body}")}'}</span> 配合 <span className="font-mono">X-Hub-Timestamp</span>（±300s 窗口）
                          </p>
                        ) : (
                          <p className="text-xs text-amber-800">未配 Secret 将允许裸 POST 触发，生产强烈建议补上。</p>
                        )}
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label>执行回执 URL</Label>
                      <Input
                        placeholder="https://partner.example.com/callbacks/jobs"
                        value={form.callbackUrl}
                        onChange={(e) => setForm({ ...form, callbackUrl: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        任务结束后 POST 成功/失败/行数；若配置了 webhookSecret，会带 X-Hub-Signature-256。
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>失败告警邮箱</Label>
                        <Input
                          placeholder="ops@example.com"
                          value={form.alertEmail}
                          onChange={(e) => setForm({ ...form, alertEmail: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>失败告警 Webhook</Label>
                        <Input
                          placeholder="https://hooks.example.com/alert"
                          value={form.alertWebhookUrl}
                          onChange={(e) => setForm({ ...form, alertWebhookUrl: e.target.value })}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-2">
                      仅在失败/部分失败时发送。未填则沿用集成凭证上的告警配置。邮件需配置 SMTP_HOST。
                    </p>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>批次大小</Label>
                        <Input
                          type="number"
                          value={form.batchSize}
                          onChange={(e) => setForm({ ...form, batchSize: Number(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground">每批处理的数据条数</p>
                      </div>
                      <div className="space-y-2">
                        <Label>失败重试次数</Label>
                        <Input
                          type="number"
                          value={form.retryCount}
                          onChange={(e) => setForm({ ...form, retryCount: Number(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground">整次执行失败后自动再入队的次数</p>
                      </div>
                      <div className="space-y-2">
                        <Label>重试间隔（秒）</Label>
                        <Input
                          type="number"
                          value={form.retryInterval}
                          onChange={(e) => setForm({ ...form, retryInterval: Number(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground">每次重试间隔</p>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="dag" className="mt-0 space-y-4">
                    {(() => {
                      const parsed = parseDagSteps(form.dagSteps);
                      return (
                        <>
                          {parsed.error && (
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-destructive">{parsed.error}</p>
                              <button
                                type="button"
                                className="text-xs text-blue-600 hover:underline"
                                onClick={() => setForm({ ...form, dagSteps: '' })}
                              >
                                清空重排
                              </button>
                            </div>
                          )}
                          <DagCanvas
                            steps={parsed.steps}
                            onChange={(steps) => setForm({ ...form, dagSteps: stringifyDagSteps(steps) })}
                            datasources={datasourceList}
                            jobs={jobs.filter((j) => j.id !== editingId)}
                            defaultSourceId={form.sourceDatasourceId}
                            defaultTargetId={form.targetDatasourceId}
                          />
                        </>
                      );
                    })()}
                    {formErrors.dagSteps && <p className="text-xs text-destructive">{formErrors.dagSteps}</p>}
                    <p className="text-xs text-muted-foreground">
                      每步可含 sourceDatasourceId / targetDatasourceId / fieldMapping / jobId / dependsOn。空则按单步 ETL。
                    </p>
                  </TabsContent>

                  {/* 高级设置 */}
                  <TabsContent value="advanced" className="mt-0 space-y-4">
                    <div className="space-y-2">
                      <Label>过滤条件</Label>
                      <Textarea
                        placeholder="如：status = 'active' AND created_at > '2024-01-01'"
                        value={form.filterCondition}
                        onChange={(e) => setForm({ ...form, filterCondition: e.target.value })}
                        rows={3}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        源数据筛选，仅同步满足条件的数据。支持 <code className="rounded bg-muted px-1">status = &apos;active&apos; AND created_at &gt; &apos;2024-01-01&apos;</code>；SQL 源会下推到 WHERE，其它源在抽取后过滤。
                      </p>
                    </div>

                    <div className="flex items-start gap-2 rounded-md border p-3">
                      <Checkbox
                        id="enableVersionSnapshot"
                        checked={form.enableVersionSnapshot}
                        onCheckedChange={(v) => setForm({ ...form, enableVersionSnapshot: v === true })}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="enableVersionSnapshot">写入前保存版本快照</Label>
                        <p className="text-xs text-muted-foreground">
                          成功批次最多保留 200 条，可在执行详情中回滚到目标库。到期按保留天数自动清理。
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>写入模式</Label>
                        <select
                          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={form.writeMode}
                          onChange={(e) => setForm({ ...form, writeMode: e.target.value })}
                        >
                          <option value="insert">仅插入</option>
                          <option value="upsert" disabled={!targetAllowsUpsert}>存在则更新</option>
                          <option value="update_only" disabled={!targetAllowsUpsert}>仅更新已有记录</option>
                        </select>
                        {!targetAllowsUpsert && form.targetDatasourceId && (
                          <p className="text-xs text-muted-foreground">当前目标只支持追加写入，不能按匹配键更新已有记录。</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>冲突策略</Label>
                        <select
                          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={form.conflictStrategy}
                          onChange={(e) => setForm({ ...form, conflictStrategy: e.target.value })}
                        >
                          <option value="source_wins">源优先</option>
                          <option value="target_wins">目标优先</option>
                          <option value="newest_wins">时间优先</option>
                          <option value="manual">人工介入（进死信）</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>匹配键</Label>
                        <Input
                          placeholder="username,employee_id"
                          value={form.matchKeys}
                          onChange={(e) => setForm({ ...form, matchKeys: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">逗号分隔。upsert / 冲突策略依赖匹配键查找目标已有记录。</p>
                      </div>
                      <div className="space-y-2">
                        <Label>冲突比较字段</Label>
                        <Input
                          placeholder="updated_at"
                          value={form.conflictCompareField}
                          onChange={(e) => setForm({ ...form, conflictCompareField: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">时间优先时比较该字段，未填则用整行指纹。</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>软删除信号字段</Label>
                        <Input
                          placeholder="status"
                          value={form.softDeleteField}
                          onChange={(e) => setForm({ ...form, softDeleteField: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">源端记录命中该字段值 → 触发目标端删除（禁用/真删）。典型：HR 状态=inactive 时同步禁用钉钉用户。</p>
                      </div>
                      <div className="space-y-2">
                        <Label>软删除信号值</Label>
                        <Input
                          placeholder="inactive"
                          value={form.softDeleteValue}
                          onChange={(e) => setForm({ ...form, softDeleteValue: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">与上面字段匹配时走 delete 分支；两个都留空则永不触发删除。</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>敏感字段</Label>
                        <Input
                          placeholder="可留空，自动识别手机/邮箱/身份证等"
                          value={form.sensitiveFields}
                          onChange={(e) => setForm({ ...form, sensitiveFields: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">留空则按字段名和内容自动识别，与手填字段合并后写入死信。</p>
                      </div>
                      <div className="space-y-2">
                        <Label>脱敏方式</Label>
                        <select
                          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={form.desensitizeMode}
                          onChange={(e) => setForm({ ...form, desensitizeMode: e.target.value })}
                        >
                          {DESENSITIZE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 rounded-md border p-3">
                      <Checkbox
                        id="enableChangeAudit"
                        checked={form.enableChangeAudit}
                        onCheckedChange={(v) => setForm({ ...form, enableChangeAudit: v === true })}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="enableChangeAudit">字段变更审计</Label>
                        <p className="text-xs text-muted-foreground">
                          更新目标记录时写入变更前后值，可在审计日志中查看。
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>运行环境</Label>
                        <select
                          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={form.environment}
                          onChange={(e) => setForm({ ...form, environment: e.target.value })}
                        >
                          <option value="dev">dev</option>
                          <option value="staging">staging</option>
                          <option value="prod">prod</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label>所属集成商</Label>
                        <select
                          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={form.clientId || ''}
                          onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                        >
                          <option value="">仅控制台可见</option>
                          {partners.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.code})
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          指派后，该集成商的 API Key 可以看见并触发此任务。
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>同步方向</Label>
                        <select
                          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                          value={form.syncDirection}
                          onChange={(e) => setForm({ ...form, syncDirection: e.target.value })}
                        >
                          <option value="forward">单向</option>
                          <option value="bidirectional">双向（防回环）</option>
                          <option value="reverse">反向</option>
                        </select>
                        <p className="text-xs text-muted-foreground">
                          反向会在执行时对调源与目标，并翻转字段映射。双向需另配对端任务。
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>来源标记字段</Label>
                        <Input
                          value={form.originMarkerField}
                          onChange={(e) => setForm({ ...form, originMarkerField: e.target.value })}
                          placeholder="_ip_origin"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>对端任务 ID</Label>
                        <Input
                          value={form.pairJobId}
                          onChange={(e) => setForm({ ...form, pairJobId: e.target.value })}
                          placeholder="双向同步的另一条任务"
                        />
                      </div>
                    </div>
                    <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
                      <div className="flex gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-700 space-y-1">
                          <p className="font-medium">注意事项</p>
                          <ul className="list-disc pl-4 space-y-0.5">
                            <li>修改运行中的任务可能影响正在执行的批次</li>
                            <li>增量同步的水位值不会因修改任务而重置</li>
                            <li>字段映射变更建议先在测试环境验证</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>

              <DialogFooter className="border-t pt-4">
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={dialogLoading}>
                  取消
                </Button>
                <Button onClick={handleSubmit} disabled={dialogLoading}>
                  {dialogLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {editingId ? '保存修改' : '创建任务'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后任务配置将被清除，相关执行历史会保留。确定要删除此任务吗？
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

      <Dialog open={!!orgJob} onOpenChange={(o) => !o && setOrgJob(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>组织架构 · {orgJob?.name}</DialogTitle>
            <DialogDescription>该任务同步下来的部门树与人-部门关系</DialogDescription>
          </DialogHeader>
          {orgJob?.id && <OrgTreePanel jobId={orgJob.id} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!promoteId} onOpenChange={(o) => !o && setPromoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>晋升到生产环境</AlertDialogTitle>
            <AlertDialogDescription>
              会复制当前任务及其源/目标数据源到 prod，生成新编码。Cron / 事件调度会保留；源任务若在运行或暂停，副本保持同一状态。原任务不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handlePromote}>确认晋升</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
