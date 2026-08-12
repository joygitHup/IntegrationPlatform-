'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { executionsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Activity,
  Search,
  RefreshCw,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const STATUS_MAP: Record<string, { label: string; variant: string; icon: typeof Activity }> = {
  PENDING: { label: '等待中', variant: 'secondary', icon: Clock },
  RUNNING: { label: '执行中', variant: 'default', icon: Loader },
  SUCCESS: { label: '成功', variant: 'success', icon: CheckCircle2 },
  FAILED: { label: '失败', variant: 'destructive', icon: XCircle },
};

export default function ExecutionsPage() {
  const [executions, setExecutions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadExecutions();
    const timer = setInterval(loadExecutions, 10000);
    return () => clearInterval(timer);
  }, [status]);

  const loadExecutions = async () => {
    try {
      const params: Record<string, any> = { pageSize: 50 };
      if (status) params.status = status;
      if (keyword) params.keyword = keyword;
      const result = await executionsApi.list(params);
      setExecutions(result.items || []);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await executionsApi.get(id);
      setDetail(result);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const formatDuration = (ms: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">执行监控</h1>
            <p className="text-sm text-muted-foreground">查看任务执行历史与详细日志</p>
          </div>
          <Button variant="secondary" onClick={loadExecutions}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>

        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
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
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_MAP).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={loadExecutions}>搜索</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">共 {executions.length} 条记录</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : executions.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无执行记录
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">执行ID</th>
                      <th className="px-4 py-3 text-left font-medium">任务</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">处理行数</th>
                      <th className="px-4 py-3 text-left font-medium">失败数</th>
                      <th className="px-4 py-3 text-left font-medium">耗时</th>
                      <th className="px-4 py-3 text-left font-medium">开始时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map((exec) => {
                      const statusInfo = STATUS_MAP[exec.status] || { label: exec.status, variant: 'secondary', icon: Activity };
                      const StatusIcon = statusInfo.icon;
                      const duration = exec.startedAt && exec.finishedAt
                        ? new Date(exec.finishedAt).getTime() - new Date(exec.startedAt).getTime()
                        : null;
                      return (
                        <tr key={exec.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3 font-mono text-xs">
                            {exec.id.slice(0, 12)}...
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium">{exec.jobName || exec.jobId.slice(0, 8)}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <StatusIcon className={`h-3.5 w-3.5 ${exec.status === 'RUNNING' ? 'animate-spin' : ''} ${
                                exec.status === 'SUCCESS' ? 'text-green-500' :
                                exec.status === 'FAILED' ? 'text-red-500' :
                                exec.status === 'RUNNING' ? 'text-blue-500' : 'text-gray-400'
                              }`} />
                              <Badge variant={statusInfo.variant as any}>{statusInfo.label}</Badge>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono">{exec.totalRecords ?? 0}</td>
                          <td className="px-4 py-3 font-mono text-red-500">{exec.failedRecords ?? 0}</td>
                          <td className="px-4 py-3 font-mono text-muted-foreground">
                            {formatDuration(duration || exec.durationMs)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {exec.startedAt ? new Date(exec.startedAt).toLocaleString('zh-CN') : '-'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => loadDetail(exec.id)}
                            >
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
          </CardContent>
        </Card>
      </div>

      {/* 详情弹窗 */}
      <Dialog open={!!detail || detailLoading} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>执行详情</DialogTitle>
            <DialogDescription>
              {detail?.id && `执行ID: ${detail.id}`}
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">任务ID:</span>
                  <span className="ml-2 font-mono">{detail.jobId}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">状态:</span>
                  <Badge className="ml-2" variant={STATUS_MAP[detail.status]?.variant as any || 'secondary'}>
                    {STATUS_MAP[detail.status]?.label || detail.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">处理行数:</span>
                  <span className="ml-2 font-mono">{detail.totalRecords ?? 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">成功数:</span>
                  <span className="ml-2 font-mono text-green-600">{detail.successRecords ?? 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">失败数:</span>
                  <span className="ml-2 font-mono text-red-600">{detail.failedRecords ?? 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">重试次数:</span>
                  <span className="ml-2 font-mono">{detail.retryCount ?? 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">开始时间:</span>
                  <span className="ml-2">{detail.startedAt ? new Date(detail.startedAt).toLocaleString('zh-CN') : '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">结束时间:</span>
                  <span className="ml-2">{detail.finishedAt ? new Date(detail.finishedAt).toLocaleString('zh-CN') : '-'}</span>
                </div>
              </div>
              {detail.errorMessage && (
                <div>
                  <p className="mb-1 text-sm font-medium text-destructive">错误信息:</p>
                  <pre className="max-h-48 overflow-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                    {detail.errorMessage}
                  </pre>
                </div>
              )}
              {detail.metrics && (
                <div>
                  <p className="mb-1 text-sm font-medium">执行指标:</p>
                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(detail.metrics, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
