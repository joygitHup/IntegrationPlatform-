'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { jobsApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export default function JobsPage() {
  const { hasPermission } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  useEffect(() => {
    loadJobs();
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

  const handleTrigger = async (id: string) => {
    setTriggeringId(id);
    try {
      const result = await jobsApi.trigger(id);
      toast.success('任务已触发', { description: `执行ID: ${result.executionId.slice(0, 12)}...` });
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

  const canWrite = hasPermission('job:write');
  const canExecute = hasPermission('job:execute');

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">集成任务</h1>
            <p className="text-sm text-muted-foreground">管理数据集成任务的配置与调度</p>
          </div>
          {canWrite && (
            <Button onClick={() => toast.info('新建功能开发中...')}>
              <Plus className="mr-2 h-4 w-4" />
              新建任务
            </Button>
          )}
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
            <Button variant="secondary" onClick={loadJobs}>搜索</Button>
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
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无集成任务
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
                              job.scheduleType === 'manual' ? '手动触发' : job.scheduleType
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
                                    onClick={() => toast.info('编辑功能开发中...')}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteId(job.id)}
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

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后任务配置将被清除，确定要删除此任务吗？
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
