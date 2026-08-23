'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { appsApi, ssoLogsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Search,
  RefreshCw,
  Loader2,
  LogIn,
  LogOut,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const statusMap: Record<string, { label: string; variant: string; icon: any }> = {
  success: { label: '成功', variant: 'success', icon: CheckCircle2 },
  failed: { label: '失败', variant: 'destructive', icon: XCircle },
};

const eventTypeMap: Record<string, { label: string; icon: any }> = {
  login: { label: '登录', icon: LogIn },
  logout: { label: '登出', icon: LogOut },
  token_refresh: { label: '令牌刷新', icon: RefreshCw },
  session_revoke: { label: '会话吊销', icon: AlertCircle },
};

function formatDate(dateStr: string) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString('zh-CN');
}

function timeAgo(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export default function SsoLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [appId, setAppId] = useState('__all__');
  const [status, setStatus] = useState('__all__');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  useEffect(() => {
    loadApps();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [page, keyword, appId, status]);

  const loadApps = async () => {
    try {
      const result = await appsApi.list({ pageSize: 100 });
      setApps(result.items || []);
    } catch (error) {
      console.error('Failed to load apps:', error);
    }
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (keyword) params.keyword = keyword;
      if (appId !== '__all__') params.appId = appId;
      if (status !== '__all__') params.result = status;
      const result = await ssoLogsApi.list(params);
      setLogs(result.items || []);
      setTotal(result.total || 0);
    } catch (error) {
      console.error('Failed to load logs:', error);
      toast.error('加载日志失败');
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">SSO 登录日志</h1>
          <p className="mt-1 text-sm text-muted-foreground">查看所有单点登录的审计记录</p>
        </div>

        {/* 筛选栏 */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 items-center gap-3 flex-wrap">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索用户名..."
                  value={keyword}
                  onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
                  className="pl-10"
                />
              </div>
              <Select value={appId} onValueChange={(v) => { setAppId(v); setPage(1); }}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="应用" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部应用</SelectItem>
                  {apps.map((app) => (
                    <SelectItem key={app.id} value={app.id}>{app.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="结果" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">全部结果</SelectItem>
                  <SelectItem value="success">成功</SelectItem>
                  <SelectItem value="failed">失败</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={loadLogs}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              共 {total} 条记录
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* 日志列表 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium">时间</th>
                    <th className="px-4 py-3 text-left font-medium">事件类型</th>
                    <th className="px-4 py-3 text-left font-medium">应用</th>
                    <th className="px-4 py-3 text-left font-medium">用户</th>
                    <th className="px-4 py-3 text-left font-medium">登录方式</th>
                    <th className="px-4 py-3 text-left font-medium">结果</th>
                    <th className="px-4 py-3 text-left font-medium">IP 地址</th>
                    <th className="px-4 py-3 text-left font-medium">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                        暂无日志记录
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => {
                      const statusInfo = statusMap[log.result] || { label: log.result, variant: 'outline', icon: Clock };
                      const eventInfo = eventTypeMap[log.eventType] || { label: log.eventType, icon: Clock };
                      const StatusIcon = statusInfo.icon;
                      const EventIcon = eventInfo.icon;

                      return (
                        <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="space-y-1">
                              <div className="font-medium">{formatDate(log.createdAt)}</div>
                              <div className="text-xs text-muted-foreground">
                                {timeAgo(log.createdAt)}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <EventIcon className="h-4 w-4 text-muted-foreground" />
                              <span>{eventInfo.label}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {apps.find((a) => a.id === log.appId)?.name || (
                              <span className="font-mono text-xs text-muted-foreground">{log.appId}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span>{log.username || log.userId || '-'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-xs">
                              {log.loginType || '-'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusInfo.variant as any} className="text-xs">
                              <StatusIcon className="mr-1 h-3 w-3" />
                              {statusInfo.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              {log.ip || '-'}
                            </div>
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            {log.failureReason ? (
                              <span className="text-red-600 text-xs">{log.failureReason}</span>
                            ) : log.details ? (
                              <details className="text-xs text-muted-foreground">
                                <summary className="cursor-pointer hover:text-foreground">查看详情</summary>
                                <pre className="mt-2 max-w-xs overflow-x-auto rounded bg-muted p-2 text-xs">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              </details>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <div className="text-sm text-muted-foreground">
                共 {total} 条，第 {page}/{totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </AppLayout>
  );
}
