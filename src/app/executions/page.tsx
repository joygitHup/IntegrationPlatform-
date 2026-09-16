'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppLayout } from '@/components/app-layout';
import { executionsApi, jobsApi, snapshotsApi, workflowsApi, fieldAuditApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Clock,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Activity,
  AlertTriangle,
  Eye,
  X,
  RotateCcw,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gauge,
  ListChecks,
  GitFork,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DagCanvas } from '@/components/dag-canvas';
import { mergeStepsWithStates, normalizeDagSteps } from '@/lib/dag';

const STATUS_MAP: Record<string, { label: string; variant: string; icon: any }> = {
  pending: { label: '等待中', variant: 'secondary', icon: Clock },
  running: { label: '执行中', variant: 'default', icon: Loader2 },
  success: { label: '成功', variant: 'success', icon: CheckCircle2 },
  failed: { label: '失败', variant: 'destructive', icon: XCircle },
  partial_failed: { label: '部分失败', variant: 'warning', icon: AlertTriangle },
  skipped: { label: '已跳过', variant: 'outline', icon: AlertTriangle },
};

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  return `${min}m ${sec}s`;
}

function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return '-';
  return n.toLocaleString();
}

export default function ExecutionsPage() {
  const { hasPermission } = useAuth();
  const router = useRouter();
  const [executions, setExecutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [jobList, setJobList] = useState<any[]>([]);
  const [summary, setSummary] = useState({ todayTotal: 0, success: 0, failed: 0, running: 0 });

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retryId, setRetryId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [rollbackSnap, setRollbackSnap] = useState<any | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [tab, setTab] = useState('exec');
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfPage, setWfPage] = useState(1);
  const [wfTotal, setWfTotal] = useState(0);
  const [wfDetail, setWfDetail] = useState<any | null>(null);
  const [wfDetailLoading, setWfDetailLoading] = useState(false);
  const [fieldAudits, setFieldAudits] = useState<any[]>([]);
  const [detailWorkflow, setDetailWorkflow] = useState<any | null>(null);

  const canRetry = hasPermission('execution:retry');

  useEffect(() => {
    loadJobs();
    loadExecutions();
  }, [statusFilter, jobFilter, page]);

  useEffect(() => {
    if (tab === 'dag') loadWorkflows();
  }, [tab, jobFilter, wfPage]);

  const loadJobs = async () => {
    try {
      const result = await jobsApi.list({ pageSize: 100 });
      setJobList(result.items || []);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  };

  const loadExecutions = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (statusFilter) params.status = statusFilter;
      if (jobFilter) params.jobId = jobFilter;
      if (keyword) params.keyword = keyword;
      const result = await executionsApi.list(params);
      setExecutions(result.items || []);
      setTotal(result.total || 0);
      if (result.summary) {
        setSummary({
          todayTotal: result.summary.todayTotal ?? result.summary.total ?? 0,
          success: result.summary.success ?? 0,
          failed: result.summary.failed ?? 0,
          running: result.summary.running ?? 0,
        });
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetailLoading(true);
    setSnapshots([]);
    setFieldAudits([]);
    setDetailWorkflow(null);
    try {
      const data = await executionsApi.get(id);
      setDetail(data);
      if (data?.jobId) {
        try {
          const snap = await snapshotsApi.list(data.jobId);
          setSnapshots(snap.items || []);
        } catch {
          setSnapshots([]);
        }
      }
      try {
        const fa = await fieldAuditApi.list({ executionId: id, pageSize: 20 });
        setFieldAudits(fa.items || []);
      } catch {
        setFieldAudits([]);
      }
      if (data?.workflowRunId) {
        try {
          const run = await workflowsApi.get(data.workflowRunId);
          setDetailWorkflow(run);
        } catch {
          setDetailWorkflow(null);
        }
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadWorkflows = async () => {
    setWfLoading(true);
    try {
      const params: Record<string, any> = { page: wfPage, pageSize };
      if (jobFilter) params.jobId = jobFilter;
      const result = await workflowsApi.list(params);
      setWorkflows(result.items || []);
      setWfTotal(result.total || 0);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWfLoading(false);
    }
  };

  const openWorkflow = async (id: string) => {
    setWfDetailLoading(true);
    try {
      const run = await workflowsApi.get(id);
      setWfDetail(run);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWfDetailLoading(false);
    }
  };

  const handleRollback = async () => {
    if (!rollbackSnap || !detail?.jobId) return;
    setRollingBack(true);
    try {
      const res = await snapshotsApi.rollback({
        jobId: detail.jobId,
        snapshotId: rollbackSnap.id,
        execute: true,
      });
      const written = res.result?.written ?? 0;
      const failed = res.result?.failed ?? 0;
      toast.success(`已回滚 ${written} 条` + (failed ? `，失败 ${failed}` : ''));
      setRollbackSnap(null);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRollingBack(false);
    }
  };

  const handleRetry = async () => {
    if (!retryId) return;
    const exec = executions.find((e) => e.id === retryId) || detail;
    const jobId = exec?.jobId || detail?.jobId;
    if (!jobId) {
      toast.error('无法确定所属任务');
      return;
    }
    try {
      await jobsApi.trigger(jobId);
      toast.success('已重新触发任务');
      setRetryId(null);
      loadExecutions();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const stats = summary;

  const getJobName = (jobId: string, fallback?: string) => {
    const job = jobList.find((j) => j.id === jobId);
    return job ? job.name : fallback || jobId?.slice(0, 12) || '-';
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">执行监控</h1>
            <p className="text-sm text-muted-foreground">执行记录与 DAG 编排步骤状态</p>
          </div>
          <Button
            variant="outline"
            onClick={tab === 'dag' ? loadWorkflows : loadExecutions}
            disabled={tab === 'dag' ? wfLoading : loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${(tab === 'dag' ? wfLoading : loading) ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">今日执行</p>
                <p className="text-2xl font-semibold">{formatNumber(stats.todayTotal)}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <ListChecks className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">成功</p>
                <p className="text-2xl font-semibold text-green-600">
                  {formatNumber(stats.success)}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">失败</p>
                <p className="text-2xl font-semibold text-red-600">
                  {formatNumber(stats.failed)}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <XCircle className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">执行中</p>
                <p className="text-2xl font-semibold text-blue-600">
                  {formatNumber(stats.running)}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Activity className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="exec">执行记录</TabsTrigger>
            <TabsTrigger value="dag">DAG 编排</TabsTrigger>
          </TabsList>
          <TabsContent value="exec">
        {/* 筛选 */}
        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索执行ID或任务名..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && loadExecutions()}
              />
            </div>
            <select
              className="h-9 min-w-[140px] rounded-md border border-input bg-background px-3 text-sm"
              value={jobFilter}
              onChange={(e) => { setJobFilter(e.target.value); setPage(1); }}
            >
              <option value="">全部任务</option>
              {jobList.map((j) => (
                <option key={j.id} value={j.id}>{j.name}</option>
              ))}
            </select>
            <select
              className="h-9 min-w-[120px] rounded-md border border-input bg-background px-3 text-sm"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_MAP).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={loadExecutions}>
              搜索
            </Button>
          </CardContent>
        </Card>

        {/* 列表 */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">执行记录 · 共 {total} 条</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : executions.length === 0 ? (
              <div className="py-16 text-center">
                <Clock className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">暂无执行记录</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 text-left font-medium">执行ID</th>
                        <th className="px-4 py-3 text-left font-medium">任务</th>
                        <th className="px-4 py-3 text-left font-medium">状态</th>
                        <th className="px-4 py-3 text-right font-medium">处理行数</th>
                        <th className="px-4 py-3 text-right font-medium">耗时</th>
                        <th className="px-4 py-3 text-left font-medium">重试</th>
                        <th className="px-4 py-3 text-left font-medium">开始时间</th>
                        <th className="px-4 py-3 text-center font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executions.map((exec) => {
                        const statusInfo = STATUS_MAP[exec.status] || { label: exec.status, variant: 'secondary', icon: Clock };
                        const StatusIcon = statusInfo.icon;
                        return (
                          <tr key={exec.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <span className="font-mono text-xs">{exec.id.slice(0, 16)}...</span>
                            </td>
                            <td className="px-4 py-3 font-medium">{getJobName(exec.jobId, exec.jobName)}</td>
                            <td className="px-4 py-3">
                              <Badge variant={statusInfo.variant as any} className="gap-1">
                                {exec.status === 'running' ? (
                                  <StatusIcon className="h-3 w-3 animate-spin" />
                                ) : (
                                  <StatusIcon className="h-3 w-3" />
                                )}
                                {statusInfo.label}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums">
                              {formatNumber(exec.processedRows)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono tabular-nums">
                              {formatDuration(exec.duration)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={exec.retryCount > 0 ? 'text-amber-600' : 'text-muted-foreground'}>
                                {exec.retryCount || 0}/{exec.maxRetries || 0}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {exec.startedAt ? new Date(exec.startedAt).toLocaleString('zh-CN') : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => openDetail(exec.id)}
                                  title="查看详情"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {canRetry && exec.status === 'failed' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-amber-600 hover:text-amber-600"
                                    onClick={() => setRetryId(exec.id)}
                                    title="重新执行"
                                  >
                                    <RotateCcw className="h-4 w-4" />
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

                {/* 分页 */}
                <div className="flex items-center justify-between border-t p-4">
                  <p className="text-sm text-muted-foreground">
                    共 {total} 条，第 {page} / {totalPages || 1} 页
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm min-w-[60px] text-center">{page} / {totalPages || 1}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="dag">
            <Card className="mb-4">
              <CardContent className="flex items-center gap-4 p-4">
                <select
                  className="h-9 min-w-[140px] rounded-md border border-input bg-background px-3 text-sm"
                  value={jobFilter}
                  onChange={(e) => { setJobFilter(e.target.value); setWfPage(1); }}
                >
                  <option value="">全部任务</option>
                  {jobList.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
                <Button variant="secondary" onClick={loadWorkflows}>刷新</Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base font-medium">编排运行 · 共 {wfTotal} 条</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {wfLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : workflows.length === 0 ? (
                  <div className="py-16 text-center">
                    <GitFork className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">暂无 DAG 运行。任务配置 dagSteps 后执行会出现在这里。</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left font-medium">运行 ID</th>
                          <th className="px-4 py-3 text-left font-medium">任务</th>
                          <th className="px-4 py-3 text-left font-medium">状态</th>
                          <th className="px-4 py-3 text-left font-medium">步骤</th>
                          <th className="px-4 py-3 text-left font-medium">开始时间</th>
                          <th className="px-4 py-3 text-center font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workflows.map((run) => {
                          const statusInfo = STATUS_MAP[run.status] || { label: run.status, variant: 'secondary', icon: Clock };
                          const states = run.stepStates || {};
                          const stepSummary = Object.entries(states).map(([id, st]) => `${id}:${st}`).join(' · ') || '-';
                          return (
                            <tr key={run.id} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-3 font-mono text-xs">{String(run.id).slice(0, 16)}...</td>
                              <td className="px-4 py-3">{getJobName(run.jobId)}</td>
                              <td className="px-4 py-3">
                                <Badge variant={statusInfo.variant as any}>{statusInfo.label}</Badge>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground max-w-[280px] truncate" title={stepSummary}>
                                {stepSummary}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : '-'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openWorkflow(run.id)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {Math.ceil(wfTotal / pageSize) > 1 && (
                  <div className="flex items-center justify-between border-t p-4">
                    <p className="text-sm text-muted-foreground">第 {wfPage} / {Math.ceil(wfTotal / pageSize) || 1} 页</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={wfPage <= 1} onClick={() => setWfPage((p) => p - 1)}>上一页</Button>
                      <Button variant="outline" size="sm" disabled={wfPage >= Math.ceil(wfTotal / pageSize)} onClick={() => setWfPage((p) => p + 1)}>下一页</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* 详情对话框 */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              执行详情
              {detail && (() => {
                const si = STATUS_MAP[detail.status] || { label: detail.status, variant: 'secondary' };
                return <Badge variant={si.variant as any}>{si.label}</Badge>;
              })()}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {detail?.id}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <div className="flex-1 overflow-y-auto space-y-6 px-2">
              {/* 基本信息 */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1 rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">任务名称</p>
                  <p className="text-sm font-medium">{getJobName(detail.jobId, detail.jobName)}</p>
                </div>
                <div className="space-y-1 rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">触发方式</p>
                  <p className="text-sm font-medium">
                    {detail.triggerType === 'manual' ? '手动触发' :
                     detail.triggerType === 'cron' ? '定时调度' :
                     detail.triggerType || '-'}
                  </p>
                </div>
                <div className="space-y-1 rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">同步模式</p>
                  <p className="text-sm font-medium">
                    {detail.syncMode === 'incremental' ? '增量同步' : detail.syncMode === 'full' ? '全量同步' : detail.syncMode || '-'}
                  </p>
                </div>
              </div>

              {/* 执行指标 */}
              <div className="grid grid-cols-4 gap-3">
                <Card>
                  <CardContent className="flex flex-col items-center p-4">
                    <Gauge className="mb-2 h-5 w-5 text-blue-500" />
                    <p className="text-lg font-semibold">{formatNumber(detail.processedRows)}</p>
                    <p className="text-xs text-muted-foreground">处理行数</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col items-center p-4">
                    <Clock3 className="mb-2 h-5 w-5 text-green-500" />
                    <p className="text-lg font-semibold">{formatDuration(detail.duration)}</p>
                    <p className="text-xs text-muted-foreground">总耗时</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col items-center p-4">
                    <RefreshCw className="mb-2 h-5 w-5 text-amber-500" />
                    <p className="text-lg font-semibold">{detail.retryCount || 0}/{detail.maxRetries || 0}</p>
                    <p className="text-xs text-muted-foreground">已重试</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex flex-col items-center p-4">
                    <CheckCircle2 className={`mb-2 h-5 w-5 ${detail.status === 'success' ? 'text-green-500' : 'text-red-500'}`} />
                    <p className={`text-lg font-semibold ${detail.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                      {detail.errorMessage ? '有' : '无'}
                    </p>
                    <p className="text-xs text-muted-foreground">错误</p>
                  </CardContent>
                </Card>
              </div>

              {/* 时间线 */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">执行时间</h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground mb-1">开始时间</p>
                    <p className="font-mono text-xs">{detail.startedAt ? new Date(detail.startedAt).toLocaleString('zh-CN') : '-'}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground mb-1">结束时间</p>
                    <p className="font-mono text-xs">{detail.endedAt ? new Date(detail.endedAt).toLocaleString('zh-CN') : '-'}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground mb-1">执行耗时</p>
                    <p className="font-mono text-xs">{formatDuration(detail.duration)}</p>
                  </div>
                </div>
              </div>

              {/* 水位线 */}
              {detail.watermarkValue && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">水位线</h4>
                  <div className="rounded-md bg-blue-50 border border-blue-200 p-3 font-mono text-xs text-blue-700">
                    {detail.watermarkField || 'watermark'} = {detail.watermarkValue}
                  </div>
                </div>
              )}

              {/* 错误信息 */}
              {detail.errorMessage && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-destructive flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    错误信息
                  </h4>
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 max-h-60 overflow-y-auto">
                    <pre className="text-xs font-mono text-destructive whitespace-pre-wrap break-words">
                      {detail.errorMessage}
                    </pre>
                  </div>
                </div>
              )}

              {/* 失败数据概览 */}
              {(detail.failedRows || 0) > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm text-amber-700">
                      有 <strong>{detail.failedRows}</strong> 条失败数据已进入死信队列
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => router.push(`/dead-letters?executionId=${detail.id}`)}
                  >
                    查看死信队列
                  </Button>
                </div>
              )}

              {detail.stepId && (
                <p className="text-xs text-muted-foreground">DAG 步骤：{detail.stepId}</p>
              )}

              {detailWorkflow && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <GitFork className="h-4 w-4" />
                    编排画布
                    <Badge variant="secondary">{detailWorkflow.status}</Badge>
                  </h4>
                  <DagCanvas
                    readOnly
                    steps={mergeStepsWithStates(normalizeDagSteps(detailWorkflow.dagSteps), detailWorkflow.stepStates)}
                    stepStates={detailWorkflow.stepStates}
                    selectedId={detail.stepId}
                    executions={detailWorkflow.executions || []}
                    onOpenExecution={openDetail}
                  />
                </div>
              )}

              {fieldAudits.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">字段变更（本执行）</h4>
                  <div className="max-h-48 overflow-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-2 py-1.5 text-left">记录</th>
                          <th className="px-2 py-1.5 text-left">操作</th>
                          <th className="px-2 py-1.5 text-left">字段</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fieldAudits.map((fa) => (
                          <tr key={fa.id} className="border-b last:border-0">
                            <td className="px-2 py-1.5 font-mono">{fa.recordKey}</td>
                            <td className="px-2 py-1.5">{fa.operation}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {(Array.isArray(fa.changes) ? fa.changes.map((c: any) => c.field) : []).filter(Boolean).join(', ') || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {snapshots.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">版本快照</h4>
                  <div className="space-y-2">
                    {snapshots.slice(0, 8).map((snap) => (
                      <div key={snap.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                        <div>
                          <p className="font-mono text-xs">{snap.id}</p>
                          <p className="text-xs text-muted-foreground">
                            v{snap.version} · {snap.snapshotType} · {snap.recordCount} 条
                            {snap.createdAt ? ` · ${new Date(snap.createdAt).toLocaleString('zh-CN')}` : ''}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setRollbackSnap(snap)}>
                          回滚
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!wfDetail} onOpenChange={(o) => !o && setWfDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              DAG 运行
              {wfDetail && (
                <Badge variant={(STATUS_MAP[wfDetail.status]?.variant || 'secondary') as any}>
                  {STATUS_MAP[wfDetail.status]?.label || wfDetail.status}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">{wfDetail?.id}</DialogDescription>
          </DialogHeader>
          {wfDetailLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : wfDetail ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {getJobName(wfDetail.jobId)} · {wfDetail.triggerType || '-'}
              </p>
              <DagCanvas
                readOnly
                steps={mergeStepsWithStates(normalizeDagSteps(wfDetail.dagSteps), wfDetail.stepStates)}
                stepStates={wfDetail.stepStates}
                jobs={jobList}
                executions={wfDetail.executions || []}
                onOpenExecution={(id) => { setWfDetail(null); openDetail(id); }}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 重跑确认 */}
      <AlertDialog open={!!retryId} onOpenChange={(o) => !o && setRetryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新执行任务</AlertDialogTitle>
            <AlertDialogDescription>
              将重新触发此执行对应的集成任务，数据会重新同步一次。确定要重新执行吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRetry}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重新执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!rollbackSnap} onOpenChange={(o) => !o && setRollbackSnap(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>执行快照回滚</AlertDialogTitle>
            <AlertDialogDescription>
              将把快照中的 {rollbackSnap?.recordCount || 0} 条数据写回目标数据源（按匹配键更新或插入）。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRollback} disabled={rollingBack}>
              {rollingBack ? '回滚中...' : '确认回滚'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
