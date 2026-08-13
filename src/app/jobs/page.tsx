'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { jobsApi, datasourcesApi } from '@/lib/api-client';
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

const SCHEDULE_TYPE_MAP: Record<string, string> = {
  manual: '手动触发',
  cron: '定时调度',
  event: '事件触发',
  webhook: 'Webhook',
};

const TRANSFORM_OPTIONS = [
  { value: '', label: '直接映射' },
  { value: 'trim', label: '去除空白 (trim)' },
  { value: 'upper', label: '转大写 (upper)' },
  { value: 'lower', label: '转小写 (lower)' },
  { value: 'toInt', label: '转整数 (toInt)' },
  { value: 'toFloat', label: '转浮点数 (toFloat)' },
  { value: 'toString', label: '转字符串 (toString)' },
  { value: 'toDate', label: '转日期 (toDate)' },
  { value: 'defaultValue', label: '默认值填充' },
];

interface FieldMapping {
  source: string;
  target: string;
  transform: string;
  defaultValue: string;
  required: boolean;
}

const defaultMapping: FieldMapping = {
  source: '',
  target: '',
  transform: '',
  defaultValue: '',
  required: false,
};

interface JobForm {
  name: string;
  code: string;
  description: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  syncMode: string;
  watermarkField: string;
  scheduleType: string;
  scheduleCron: string;
  batchSize: number;
  retryCount: number;
  retryInterval: number;
  sourceTable: string;
  targetTable: string;
  fieldMapping: FieldMapping[];
  filterCondition: string;
}

const emptyForm: JobForm = {
  name: '',
  code: '',
  description: '',
  sourceDatasourceId: '',
  targetDatasourceId: '',
  syncMode: 'full',
  watermarkField: '',
  scheduleType: 'manual',
  scheduleCron: '0 */5 * * * *',
  batchSize: 1000,
  retryCount: 3,
  retryInterval: 60,
  sourceTable: '',
  targetTable: '',
  fieldMapping: [{ ...defaultMapping }],
  filterCondition: '',
};

export default function JobsPage() {
  const { hasPermission } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogLoading, setDialogLoading] = useState(false);
  const [form, setForm] = useState<JobForm>({ ...emptyForm });
  const [datasourceList, setDatasourceList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('basic');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const canWrite = hasPermission('job:write');
  const canExecute = hasPermission('job:execute');

  useEffect(() => {
    loadJobs();
    loadDatasources();
  }, [status]);

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
      const result = await datasourcesApi.list({ pageSize: 100 });
      setDatasourceList(result.items || []);
    } catch (error) {
      console.error('Failed to load datasources:', error);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyForm, fieldMapping: [{ ...defaultMapping }] });
    setFormErrors({});
    setActiveTab('basic');
    setDialogOpen(true);
  };

  const openEdit = async (job: any) => {
    setEditingId(job.id);
    setDialogLoading(true);
    setDialogOpen(true);
    try {
      const detail = await jobsApi.get(job.id);
      setForm({
        name: detail.name || '',
        code: detail.code || '',
        description: detail.description || '',
        sourceDatasourceId: detail.sourceDatasourceId || '',
        targetDatasourceId: detail.targetDatasourceId || '',
        syncMode: detail.syncMode || 'full',
        watermarkField: detail.watermarkField || '',
        scheduleType: detail.scheduleType || 'manual',
        scheduleCron: detail.scheduleCron || '0 */5 * * * *',
        batchSize: detail.batchSize || 1000,
        retryCount: detail.retryCount ?? 3,
        retryInterval: detail.retryInterval ?? 60,
        sourceTable: detail.sourceConfig?.table || detail.sourceConfig?.path || '',
        targetTable: detail.targetConfig?.table || detail.targetConfig?.path || '',
        fieldMapping: (detail.fieldMapping || []).map((m: any) => ({
          source: m.source || '',
          target: m.target || '',
          transform: m.transform || '',
          defaultValue: m.defaultValue || '',
          required: m.required || false,
        })),
        filterCondition: detail.filterCondition || '',
      });
      setFormErrors({});
      setActiveTab('basic');
    } catch (error) {
      toast.error((error as Error).message);
      setDialogOpen(false);
    } finally {
      setDialogLoading(false);
    }
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = '请输入任务名称';
    if (!form.code.trim()) errors.code = '请输入任务编码';
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(form.code)) errors.code = '编码只能包含字母、数字和下划线，且以字母开头';
    if (!form.sourceDatasourceId) errors.sourceDatasourceId = '请选择源数据源';
    if (!form.targetDatasourceId) errors.targetDatasourceId = '请选择目标数据源';
    if (form.scheduleType === 'cron' && !form.scheduleCron.trim()) errors.scheduleCron = '请输入 Cron 表达式';
    if (form.syncMode === 'incremental' && !form.watermarkField.trim()) {
      errors.watermarkField = '增量同步需指定水位字段';
    }
    if (form.fieldMapping.length > 0) {
      const hasValid = form.fieldMapping.some((m) => m.source.trim() && m.target.trim());
      if (!hasValid) errors.fieldMapping = '至少配置一条有效的字段映射';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      setActiveTab('basic');
      toast.error('请检查表单填写');
      return;
    }

    setDialogLoading(true);
    try {
      const payload: Record<string, any> = {
        name: form.name,
        code: form.code,
        description: form.description,
        sourceDatasourceId: form.sourceDatasourceId,
        targetDatasourceId: form.targetDatasourceId,
        syncMode: form.syncMode,
        watermarkField: form.syncMode === 'incremental' ? form.watermarkField : undefined,
        scheduleType: form.scheduleType,
        scheduleCron: form.scheduleType === 'cron' ? form.scheduleCron : undefined,
        batchSize: Number(form.batchSize) || 1000,
        retryCount: Number(form.retryCount) || 0,
        retryInterval: Number(form.retryInterval) || 60,
        filterCondition: form.filterCondition || undefined,
        sourceConfig: form.sourceTable ? { table: form.sourceTable } : {},
        targetConfig: form.targetTable ? { table: form.targetTable } : {},
        fieldMapping: form.fieldMapping
          .filter((m) => m.source.trim() && m.target.trim())
          .map((m) => ({
            source: m.source.trim(),
            target: m.target.trim(),
            transform: m.transform || undefined,
            defaultValue: m.defaultValue || undefined,
            required: m.required || undefined,
          })),
      };

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

  const getDatasourceName = (id: string) => {
    const ds = datasourceList.find((d) => d.id === id);
    return ds ? ds.name : id?.slice(0, 8) || '-';
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
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <ArrowRightLeft className="h-3 w-3" />
                              <span>{SYNC_MODE_MAP[job.syncMode] || job.syncMode}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {job.scheduleType === 'cron' && job.scheduleCron ? (
                              <code className="rounded bg-muted px-1.5 py-0.5">{job.scheduleCron}</code>
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
                              {job.scheduleType === 'cron' && canWrite && (
                                <>
                                  {job.status !== 'running' ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => handleControl(job.id, 'start')}
                                      title="启动调度"
                                    >
                                      <PlayCircle className="h-4 w-4" />
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-2"
                                      onClick={() => handleControl(job.id, 'stop')}
                                      title="停止调度"
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
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
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
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          className={formErrors.name ? 'border-destructive' : ''}
                        />
                        {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label>任务编码 <span className="text-destructive">*</span></Label>
                        <Input
                          placeholder="如：user_sync_01"
                          value={form.code}
                          onChange={(e) => setForm({ ...form, code: e.target.value })}
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
                          源数据源 <span className="text-destructive">*</span>
                        </Label>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={form.sourceDatasourceId}
                          onChange={(e) => setForm({ ...form, sourceDatasourceId: e.target.value })}
                        >
                          <option value="">请选择源数据源</option>
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
                          onChange={(e) => setForm({ ...form, targetDatasourceId: e.target.value })}
                        >
                          <option value="">请选择目标数据源</option>
                          {datasourceList.map((ds) => (
                            <option key={ds.id} value={ds.id}>{ds.name} ({ds.type})</option>
                          ))}
                        </select>
                        {formErrors.targetDatasourceId && <p className="text-xs text-destructive">{formErrors.targetDatasourceId}</p>}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>源表/路径</Label>
                        <Input
                          placeholder="如：users 或 /api/users"
                          value={form.sourceTable}
                          onChange={(e) => setForm({ ...form, sourceTable: e.target.value })}
                        />
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
                        {Object.entries(SYNC_MODE_MAP).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="syncMode"
                              value={key}
                              checked={form.syncMode === key}
                              onChange={(e) => setForm({ ...form, syncMode: e.target.value })}
                              className="h-4 w-4"
                            />
                            <span className="text-sm">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {form.syncMode === 'incremental' && (
                      <div className="space-y-2 rounded-lg bg-blue-50/50 p-4 border border-blue-100">
                        <Label className="text-blue-700">水位字段（增量同步基准）</Label>
                        <Input
                          placeholder="如：updated_at / id"
                          value={form.watermarkField}
                          onChange={(e) => setForm({ ...form, watermarkField: e.target.value })}
                          className={formErrors.watermarkField ? 'border-destructive' : ''}
                        />
                        {formErrors.watermarkField && <p className="text-xs text-destructive">{formErrors.watermarkField}</p>}
                        <p className="text-xs text-blue-600">
                          每次同步后记录该字段最大值，下一次仅同步大于该值的数据
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  {/* 字段映射 */}
                  <TabsContent value="mapping" className="mt-0 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        配置源字段到目标字段的映射关系，支持数据转换
                      </p>
                      <Button variant="outline" size="sm" onClick={addMapping}>
                        <PlusCircle className="mr-2 h-3.5 w-3.5" />
                        添加字段
                      </Button>
                    </div>

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
                          <div key={index} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                            <div className="col-span-1 text-muted-foreground">
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <div className="col-span-3">
                              <Input
                                size={1}
                                placeholder="source_field"
                                value={mapping.source}
                                onChange={(e) => updateMapping(index, 'source', e.target.value)}
                                className="h-8 text-xs"
                              />
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
                        ))}
                      </div>
                    </div>

                    <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                      <p className="font-medium">💡 转换说明</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li><strong>直接映射</strong>：源字段值原样写入目标字段</li>
                        <li><strong>trim / upper / lower</strong>：字符串处理</li>
                        <li><strong>toInt / toFloat / toString / toDate</strong>：类型转换</li>
                        <li><strong>默认值填充</strong>：源字段为空时使用默认值</li>
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
                              onClick={() => setForm({ ...form, scheduleType: item.key })}
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
                          格式：分 时 日 月 周 &nbsp; 示例：<code className="bg-blue-100 px-1 rounded">0 2 * * *</code> 表示每天凌晨 2 点
                        </p>
                      </div>
                    )}

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
                        <p className="text-xs text-muted-foreground">最多重试次数</p>
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
                        源数据的筛选条件，仅同步满足条件的数据
                      </p>
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
    </AppLayout>
  );
}
