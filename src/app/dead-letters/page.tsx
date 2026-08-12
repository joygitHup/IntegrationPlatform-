'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { deadLettersApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertTriangle,
  Search,
  RefreshCw,
  Loader2,
  RotateCcw,
  Eye,
  Trash2,
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

export default function DeadLettersPage() {
  const [letters, setLetters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retryId, setRetryId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadLetters();
  }, [status]);

  const loadLetters = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { pageSize: 50 };
      if (status) params.status = status;
      const result = await deadLettersApi.list(params);
      setLetters(result.items || []);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!retryId) return;
    try {
      await deadLettersApi.retry(retryId);
      toast.success('已提交重新处理');
      loadLetters();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRetryId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deadLettersApi.delete(deleteId);
      toast.success('已删除');
      loadLetters();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  const viewDetail = (item: any) => {
    setDetailLoading(true);
    setDetail(item);
    setTimeout(() => setDetailLoading(false), 100);
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">死信队列</h1>
            <p className="text-sm text-muted-foreground">处理同步失败的数据记录</p>
          </div>
          <Button variant="secondary" onClick={loadLetters}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>

        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索记录..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="pending">待处理</option>
              <option value="retried">已重试</option>
              <option value="resolved">已解决</option>
              <option value="ignored">已忽略</option>
            </select>
            <Button variant="secondary" onClick={loadLetters}>筛选</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">共 {letters.length} 条死信</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : letters.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无死信记录
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">记录ID</th>
                      <th className="px-4 py-3 text-left font-medium">任务</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">重试次数</th>
                      <th className="px-4 py-3 text-left font-medium">失败原因</th>
                      <th className="px-4 py-3 text-left font-medium">创建时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {letters.map((dl) => (
                      <tr key={dl.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3 font-mono text-xs">{dl.id.slice(0, 12)}...</td>
                        <td className="px-4 py-3">{dl.jobId?.slice(0, 12) || '未知'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={
                            dl.status === 'pending' ? 'destructive' :
                            dl.status === 'retried' ? 'default' :
                            dl.status === 'resolved' ? 'success' : 'secondary'
                          }>
                            {dl.status === 'pending' ? '待处理' :
                             dl.status === 'retried' ? '已重试' :
                             dl.status === 'resolved' ? '已解决' : '已忽略'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono">{dl.retryCount ?? 0}</td>
                        <td className="px-4 py-3 max-w-xs truncate text-xs text-red-600" title={dl.errorMessage}>
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                            {dl.errorMessage || '未知错误'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {dl.createdAt ? new Date(dl.createdAt).toLocaleString('zh-CN') : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => viewDetail(dl)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {dl.status === 'pending' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2 text-blue-600 hover:text-blue-600"
                                onClick={() => setRetryId(dl.id)}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-destructive hover:text-destructive"
                              onClick={() => setDeleteId(dl.id)}
                            >
                              <Trash2 className="h-4 w-4" />
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

      {/* 详情 */}
      <Dialog open={!!detail || detailLoading} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>死信详情</DialogTitle>
            <DialogDescription>{detail?.id}</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-sm font-medium">原始数据:</p>
                <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {detail.payload ? JSON.stringify(detail.payload, null, 2) : '-'}
                </pre>
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-destructive">错误信息:</p>
                <pre className="max-h-32 overflow-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                  {detail.errorMessage || '-'}
                </pre>
              </div>
              {detail.errorStack && (
                <div>
                  <p className="mb-1 text-sm font-medium text-destructive">堆栈:</p>
                  <pre className="max-h-32 overflow-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                    {detail.errorStack}
                  </pre>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 重试确认 */}
      <AlertDialog open={!!retryId} onOpenChange={(o) => !o && setRetryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认重新处理</AlertDialogTitle>
            <AlertDialogDescription>
              将重新将此条数据放入队列处理，确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRetry}>重新处理</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将无法恢复，确定要删除此条死信吗？
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
