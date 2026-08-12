'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { auditLogsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FileText,
  Search,
  RefreshCw,
  Loader2,
  User,
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

const ACTION_MAP: Record<string, { label: string; variant: string }> = {
  LOGIN: { label: '登录', variant: 'default' },
  LOGOUT: { label: '登出', variant: 'secondary' },
  CREATE: { label: '创建', variant: 'success' },
  UPDATE: { label: '更新', variant: 'warning' },
  DELETE: { label: '删除', variant: 'destructive' },
  EXECUTE: { label: '执行', variant: 'default' },
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => {
    loadLogs();
  }, [action, resourceType]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { pageSize: 100 };
      if (action) params.action = action;
      if (resourceType) params.resourceType = resourceType;
      if (keyword) params.keyword = keyword;
      const result = await auditLogsApi.list(params);
      setLogs(result.items || []);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">操作审计</h1>
            <p className="text-sm text-muted-foreground">记录所有用户的操作行为</p>
          </div>
          <Button variant="secondary" onClick={loadLogs}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>

        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索用户名或资源ID..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">全部操作</option>
              {Object.entries(ACTION_MAP).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
            >
              <option value="">全部资源</option>
              <option value="USER">用户</option>
              <option value="DATASOURCE">数据源</option>
              <option value="JOB">任务</option>
              <option value="EXECUTION">执行</option>
              <option value="SYSTEM">系统</option>
            </select>
            <Button variant="secondary" onClick={loadLogs}>搜索</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">共 {logs.length} 条记录</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无审计记录
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">时间</th>
                      <th className="px-4 py-3 text-left font-medium">操作人</th>
                      <th className="px-4 py-3 text-left font-medium">操作</th>
                      <th className="px-4 py-3 text-left font-medium">资源类型</th>
                      <th className="px-4 py-3 text-left font-medium">资源ID</th>
                      <th className="px-4 py-3 text-left font-medium">IP</th>
                      <th className="px-4 py-3 text-right font-medium">详情</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const actionInfo = ACTION_MAP[log.action] || { label: log.action, variant: 'secondary' };
                      return (
                        <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {log.createdAt ? new Date(log.createdAt).toLocaleString('zh-CN') : '-'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                                <User className="h-3 w-3 text-primary" />
                              </div>
                              <span>{log.username || log.userId || '系统'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={actionInfo.variant as any}>{actionInfo.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{log.resourceType || '-'}</td>
                          <td className="px-4 py-3 font-mono text-xs">{log.resourceId || '-'}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.ip || '-'}</td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={() => setDetail(log)}
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

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>审计详情</DialogTitle>
            <DialogDescription>
              {detail?.id && `记录ID: ${detail.id}`}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-muted-foreground">操作人:</span>
                  <span className="ml-2">{detail.username || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">操作:</span>
                  <span className="ml-2">{ACTION_MAP[detail.action]?.label || detail.action}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">资源类型:</span>
                  <span className="ml-2">{detail.resourceType || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">资源ID:</span>
                  <span className="ml-2 font-mono">{detail.resourceId || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">IP:</span>
                  <span className="ml-2 font-mono">{detail.ip || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">时间:</span>
                  <span className="ml-2">{detail.createdAt ? new Date(detail.createdAt).toLocaleString('zh-CN') : '-'}</span>
                </div>
              </div>
              {detail.detail && (
                <div>
                  <p className="mb-1 font-medium">详细信息:</p>
                  <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {typeof detail.detail === 'string' ? detail.detail : JSON.stringify(detail.detail, null, 2)}
                  </pre>
                </div>
              )}
              {detail.userAgent && (
                <div>
                  <p className="mb-1 font-medium">User Agent:</p>
                  <pre className="max-h-20 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
                    {detail.userAgent}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
