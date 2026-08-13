'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { deadLettersApi, jobsApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertTriangle,
  Search,
  RotateCcw,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle,
  XCircle,
  Clock,
  Database,
  FileJson,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  pending: { label: '待处理', variant: 'warning' },
  reprocessing: { label: '重处理中', variant: 'default' },
  ignored: { label: '已忽略', variant: 'outline' },
  resolved: { label: '已解决', variant: 'success' },
};

export default function DeadLettersPage() {
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [jobFilter, setJobFilter] = useState('');
  const [jobList, setJobList] = useState<any[]>([]);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // 批量操作对话框
  const [batchAction, setBatchAction] = useState<'reprocess' | 'ignore' | null>(null);

  const canRetry = hasPermission('deadletter:retry');
  const canDelete = hasPermission('deadletter:delete');

  useEffect(() => {
    loadJobs();
    loadDeadLetters();
  }, [statusFilter, jobFilter, page]);

  const loadJobs = async () => {
    try {
      const result = await jobsApi.list({ pageSize: 100 });
      setJobList(result.items || []);
    } catch (error) {
      console.error('Failed to load jobs:', error);
    }
  };

  const loadDeadLetters = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (statusFilter) params.status = statusFilter;
      if (jobFilter) params.jobId = jobFilter;
      const result = await deadLettersApi.list(params);
      setItems(result.items || []);
      setTotal(result.total || 0);
      setSelectedIds([]);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const getJobName = (jobId: string) => {
    const job = jobList.find((j) => j.id === jobId);
    return job ? job.name : jobId?.slice(0, 12) || '-';
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === items.length && items.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((i) => i.id));
    }
  };

  const handleBatch = async (action: 'reprocess' | 'ignore') => {
    if (selectedIds.length === 0) return;
    setActionLoading(true);
    try {
      await deadLettersApi.batchAction(selectedIds, action);
      toast.success(`${action === 'reprocess' ? '重新处理' : '已忽略'} ${selectedIds.length} 条记录`);
      setBatchAction(null);
      setSelectedIds([]);
      loadDeadLetters();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSingleAction = async (id: string, action: 'reprocess' | 'ignore') => {
    setActionLoading(true);
    try {
      await deadLettersApi.batchAction([id], action);
      toast.success(action === 'reprocess' ? '已加入重处理队列' : '已忽略');
      setDetailId(null);
      loadDeadLetters();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const viewDetail = (item: any) => {
    setDetail(item);
    setDetailId(item.id);
  };

  const totalPages = Math.ceil(total / pageSize);
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const someSelected = selectedIds.length > 0 && selectedIds.length < items.length;

  const stats = {
    pending: statusFilter === 'pending' ? total : 0,
    reprocessing: 0,
    ignored: 0,
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">死信队列</h1>
            <p className="text-sm text-muted-foreground">管理执行失败的数据记录，支持重处理和忽略</p>
          </div>
          <Button variant="outline" onClick={loadDeadLetters} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-4 gap-4">
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'pending' ? 'ring-2 ring-amber-500' : ''}`}
            onClick={() => { setStatusFilter('pending'); setPage(1); }}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">待处理</p>
                <p className="text-2xl font-semibold text-amber-600">{total}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'reprocessing' ? 'ring-2 ring-blue-500' : ''}`}
            onClick={() => { setStatusFilter('reprocessing'); setPage(1); }}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">重处理中</p>
                <p className="text-2xl font-semibold text-blue-600">
                  {items.filter((i) => i.status === 'reprocessing').length}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Loader2 className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'ignored' ? 'ring-2 ring-gray-400' : ''}`}
            onClick={() => { setStatusFilter('ignored'); setPage(1); }}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">已忽略</p>
                <p className="text-2xl font-semibold text-gray-600">
                  {items.filter((i) => i.status === 'ignored').length}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                <EyeOff className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          <Card
            className={`cursor-pointer transition-all ${statusFilter === 'resolved' ? 'ring-2 ring-green-500' : ''}`}
            onClick={() => { setStatusFilter('resolved'); setPage(1); }}
          >
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm text-muted-foreground">已解决</p>
                <p className="text-2xl font-semibold text-green-600">
                  {items.filter((i) => i.status === 'resolved').length}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-600">
                <CheckCircle className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 筛选 + 批量操作 */}
        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索执行ID或错误信息..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && loadDeadLetters()}
              />
            </div>
            <select
              className="h-9 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
              value={jobFilter}
              onChange={(e) => { setJobFilter(e.target.value); setPage(1); }}
            >
              <option value="">全部任务</option>
              {jobList.map((j) => (
                <option key={j.id} value={j.id}>{j.name}</option>
              ))}
            </select>

            <div className="flex-1" />

            {/* 批量操作 */}
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1.5 border border-blue-200">
                <span className="text-sm text-blue-700">已选 {selectedIds.length} 项</span>
                {canRetry && statusFilter === 'pending' && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-xs bg-green-600 hover:bg-green-700"
                    onClick={() => setBatchAction('reprocess')}
                  >
                    <RotateCcw className="mr-1 h-3 w-3" />
                    重新处理
                  </Button>
                )}
                {(statusFilter === 'pending' || statusFilter === 'ignored') && canDelete && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setBatchAction('ignore')}
                  >
                    <EyeOff className="mr-1 h-3 w-3" />
                    忽略
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 列表 */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">
              {STATUS_MAP[statusFilter]?.label || '全部'} · 共 {total} 条
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <div className="py-16 text-center">
                <CheckCircle className="mx-auto mb-3 h-12 w-12 text-green-500/30" />
                <p className="text-sm text-muted-foreground">
                  {statusFilter === 'pending' ? '太棒了！没有待处理的失败数据' : '暂无记录'}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-3 w-10">
                          <Checkbox
                            checked={allSelected}
                            aria-checked={someSelected ? 'mixed' : allSelected}
                            onCheckedChange={toggleSelectAll}
                          />
                        </th>
                        <th className="px-4 py-3 text-left font-medium">执行ID</th>
                        <th className="px-4 py-3 text-left font-medium">任务</th>
                        <th className="px-4 py-3 text-left font-medium">状态</th>
                        <th className="px-4 py-3 text-left font-medium">错误信息</th>
                        <th className="px-4 py-3 text-left font-medium">重试次数</th>
                        <th className="px-4 py-3 text-left font-medium">失败时间</th>
                        <th className="px-4 py-3 text-center font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const statusInfo = STATUS_MAP[item.status] || { label: item.status, variant: 'secondary' };
                        return (
                          <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-3">
                              <Checkbox
                                checked={selectedIds.includes(item.id)}
                                onCheckedChange={() => toggleSelect(item.id)}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-mono text-xs">{item.executionId?.slice(0, 14) || item.id?.slice(0, 14)}...</span>
                            </td>
                            <td className="px-4 py-3 font-medium">{getJobName(item.jobId)}</td>
                            <td className="px-4 py-3">
                              <Badge variant={statusInfo.variant as any}>{statusInfo.label}</Badge>
                            </td>
                            <td className="px-4 py-3 max-w-xs">
                              <p className="truncate text-muted-foreground text-xs" title={item.errorMessage}>
                                {item.errorMessage || '-'}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="text-xs text-muted-foreground">{item.retryCount || 0}</span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => viewDetail(item)}
                                  title="查看详情"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {canRetry && item.status === 'pending' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-green-600 hover:text-green-600"
                                    onClick={() => handleSingleAction(item.id, 'reprocess')}
                                    title="重新处理"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                )}
                                {canDelete && (item.status === 'pending' || item.status === 'ignored') && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-destructive hover:text-destructive"
                                    onClick={() => handleSingleAction(item.id, 'ignore')}
                                    title={item.status === 'ignored' ? '取消忽略' : '忽略'}
                                  >
                                    <EyeOff className="h-4 w-4" />
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
      </div>

      {/* 详情对话框 */}
      <Dialog open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              死信详情
              {detail && (
                <Badge variant={(STATUS_MAP[detail.status]?.variant || 'secondary') as any}>
                  {STATUS_MAP[detail.status]?.label || detail.status}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {detail?.id}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="flex-1 overflow-y-auto space-y-4 px-2">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">所属任务</Label>
                  <p className="font-medium">{getJobName(detail.jobId)}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">执行ID</Label>
                  <p className="font-mono text-xs">{detail.executionId || '-'}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">失败时间</Label>
                  <p className="font-mono text-xs">
                    {detail.createdAt ? new Date(detail.createdAt).toLocaleString('zh-CN') : '-'}
                  </p>
                </div>
              </div>

              <Tabs defaultValue="data">
                <TabsList>
                  <TabsTrigger value="data" className="text-xs">
                    <Database className="mr-1 h-3 w-3" />
                    原始数据
                  </TabsTrigger>
                  <TabsTrigger value="error" className="text-xs">
                    <XCircle className="mr-1 h-3 w-3" />
                    错误信息
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="data" className="mt-3">
                  <div className="rounded-md border bg-muted/20 p-3 max-h-72 overflow-y-auto">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words text-muted-foreground">
                      {detail.payload
                        ? JSON.stringify(detail.payload, null, 2)
                        : '无原始数据记录'}
                    </pre>
                  </div>
                </TabsContent>
                <TabsContent value="error" className="mt-3">
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 max-h-72 overflow-y-auto">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words text-destructive">
                      {detail.errorMessage || '无错误信息'}
                    </pre>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">已重试次数</Label>
                  <p>{detail.retryCount || 0} 次</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">处理结果</Label>
                  <p className="text-muted-foreground">{detail.resultNote || '-'}</p>
                </div>
              </div>
            </div>
          )}

          {detail && detail.status === 'pending' && (
            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => handleSingleAction(detail.id, 'ignore')}
                disabled={actionLoading}
              >
                <EyeOff className="mr-2 h-4 w-4" />
                忽略
              </Button>
              <Button onClick={() => handleSingleAction(detail.id, 'reprocess')} disabled={actionLoading} className="bg-green-600 hover:bg-green-700">
                {actionLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                重新处理
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 批量操作确认 */}
      <AlertDialog open={!!batchAction} onOpenChange={(o) => !o && setBatchAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {batchAction === 'reprocess' ? '批量重新处理' : '批量忽略'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              确定要{batchAction === 'reprocess' ? '重新处理' : '忽略'}选中的 <strong>{selectedIds.length}</strong> 条记录吗？
              {batchAction === 'reprocess' && '数据将被重新送入同步队列执行。'}
              {batchAction === 'ignore' && '忽略后数据将不再被处理。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => batchAction && handleBatch(batchAction)}
              className={batchAction === 'ignore' ? 'bg-destructive text-destructive-foreground' : 'bg-green-600 hover:bg-green-700'}
              disabled={actionLoading}
            >
              {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认{batchAction === 'reprocess' ? '重处理' : '忽略'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
