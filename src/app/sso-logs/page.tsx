'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { appsApi, ssoLogsApi, ssoSessionsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [appId, setAppId] = useState('__all__');
  const [status, setStatus] = useState('__all__');
  const [eventType, setEventType] = useState('__all__');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [tab, setTab] = useState('logs');
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionStatus, setSessionStatus] = useState('active');
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    loadApps();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [page, appliedKeyword, appId, status, eventType]);

  useEffect(() => {
    if (tab === 'sessions') loadSessions();
  }, [tab, sessionPage, sessionStatus]);

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
      if (appliedKeyword) params.keyword = appliedKeyword;
      if (appId !== '__all__') params.appId = appId;
      if (status !== '__all__') params.result = status;
      if (eventType !== '__all__') params.eventType = eventType;
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

  const loadSessions = async () => {
    setSessionLoading(true);
    try {
      const params: Record<string, any> = { page: sessionPage, pageSize };
      if (sessionStatus !== '__all__') params.status = sessionStatus;
      const result = await ssoSessionsApi.list(params);
      setSessions(result.items || []);
      setSessionTotal(result.total || 0);
    } catch (error) {
      toast.error((error as Error).message || '加载会话失败');
    } finally {
      setSessionLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeId) return;
    setRevoking(true);
    try {
      await ssoSessionsApi.revoke(revokeId);
      toast.success('已吊销会话');
      setRevokeId(null);
      loadSessions();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRevoking(false);
    }
  };

  const handleRevokeAll = async () => {
    setRevoking(true);
    try {
      const result = await ssoSessionsApi.revokeAll();
      toast.success(`已吊销 ${result.revokedCount ?? 0} 个本账号会话`);
      setRevokeAllOpen(false);
      loadSessions();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRevoking(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);
  const sessionPages = Math.max(1, Math.ceil(sessionTotal / pageSize));
  const appName = (id: string) => apps.find((a) => a.id === id)?.name || id || '-';

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">SSO 登录与会话</h1>
          <p className="mt-1 text-sm text-muted-foreground">审计记录与活跃会话吊销</p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="logs">登录日志</TabsTrigger>
            <TabsTrigger value="sessions">活跃会话</TabsTrigger>
          </TabsList>

          <TabsContent value="logs">
            <Card className="mb-4">
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-1 items-center gap-3 flex-wrap">
                    <div className="relative w-full max-w-sm">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="搜索用户名、应用或 IP..."
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        className="pl-10"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const next = keyword.trim();
                            if (page === 1 && appliedKeyword === next) loadLogs();
                            else {
                              setAppliedKeyword(next);
                              setPage(1);
                            }
                          }
                        }}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const next = keyword.trim();
                        if (page === 1 && appliedKeyword === next) loadLogs();
                        else {
                          setAppliedKeyword(next);
                          setPage(1);
                        }
                      }}
                    >
                      搜索
                    </Button>
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
                    <Select value={eventType} onValueChange={(v) => { setEventType(v); setPage(1); }}>
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="事件" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">全部事件</SelectItem>
                        {Object.entries(eventTypeMap).map(([key, val]) => (
                          <SelectItem key={key} value={key}>{val.label}</SelectItem>
                        ))}
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
                                  {log.appName || apps.find((a) => a.id === log.appId)?.name || (
                                    <span className="font-mono text-xs text-muted-foreground">{log.appId || '-'}</span>
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
                                  ) : (log.details || log.detail) ? (
                                    <details className="text-xs text-muted-foreground">
                                      <summary className="cursor-pointer hover:text-foreground">查看详情</summary>
                                      <pre className="mt-2 max-w-xs overflow-x-auto rounded bg-muted p-2 text-xs">
                                        {JSON.stringify(log.details || log.detail, null, 2)}
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
          </TabsContent>

          <TabsContent value="sessions">
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={sessionStatus}
                  onChange={(e) => { setSessionStatus(e.target.value); setSessionPage(1); }}
                >
                  <option value="active">活跃</option>
                  <option value="revoked">已吊销</option>
                  <option value="__all__">全部状态</option>
                </select>
                <Button variant="outline" size="icon" onClick={loadSessions}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">共 {sessionTotal} 条</span>
                  <Button variant="destructive" size="sm" onClick={() => setRevokeAllOpen(true)}>
                    <ShieldOff className="mr-2 h-4 w-4" />
                    踢掉本账号全部
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-0">
                {sessionLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left font-medium">登录时间</th>
                          <th className="px-4 py-3 text-left font-medium">用户</th>
                          <th className="px-4 py-3 text-left font-medium">应用</th>
                          <th className="px-4 py-3 text-left font-medium">方式</th>
                          <th className="px-4 py-3 text-left font-medium">IP</th>
                          <th className="px-4 py-3 text-left font-medium">状态</th>
                          <th className="px-4 py-3 text-right font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                              暂无会话
                            </td>
                          </tr>
                        ) : (
                          sessions.map((s) => (
                            <tr key={s.id || s.sessionId} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-3 text-xs">
                                {formatDate(s.loginAt)}
                                <div className="text-muted-foreground">{timeAgo(s.loginAt)}</div>
                              </td>
                              <td className="px-4 py-3">{s.username || s.userId || '-'}</td>
                              <td className="px-4 py-3">{appName(s.appId)}</td>
                              <td className="px-4 py-3">
                                <Badge variant="outline" className="text-xs">{s.loginType || '-'}</Badge>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.ip || '-'}</td>
                              <td className="px-4 py-3">
                                <Badge variant={s.status === 'active' ? 'success' : 'secondary'}>
                                  {s.status === 'active' ? '活跃' : s.status === 'revoked' ? '已吊销' : s.status}
                                </Badge>
                              </td>
                              <td className="px-4 py-3 text-right">
                                {s.status === 'active' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-destructive"
                                    onClick={() => setRevokeId(s.sessionId || s.id)}
                                  >
                                    踢下线
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {sessionPages > 1 && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <div className="text-sm text-muted-foreground">
                      共 {sessionTotal} 条，第 {sessionPage}/{sessionPages} 页
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={sessionPage <= 1} onClick={() => setSessionPage((p) => p - 1)}>
                        上一页
                      </Button>
                      <Button variant="outline" size="sm" disabled={sessionPage >= sessionPages} onClick={() => setSessionPage((p) => p + 1)}>
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>吊销会话</AlertDialogTitle>
            <AlertDialogDescription>该会话将立即失效，对应用户需要重新登录。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevoke} disabled={revoking}>确认踢下线</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>吊销本账号全部会话</AlertDialogTitle>
            <AlertDialogDescription>将踢掉当前登录账号的所有活跃 SSO 会话（不含控制台 JWT）。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevokeAll} disabled={revoking}>全部踢下线</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
