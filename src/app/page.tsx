'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppLayout } from '@/components/app-layout';
import { dashboardApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  GitBranch,
  PlayCircle,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Gauge,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

function execTone(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'success') return { dot: 'bg-green-500', badge: 'success' as const, label: '成功' };
  if (s === 'partial_failed') return { dot: 'bg-amber-500', badge: 'secondary' as const, label: '部分失败' };
  if (s === 'failed' || s === 'error') return { dot: 'bg-red-500', badge: 'destructive' as const, label: '失败' };
  if (s === 'running') return { dot: 'bg-blue-500 animate-pulse', badge: 'secondary' as const, label: '执行中' };
  if (s === 'pending') return { dot: 'bg-gray-400', badge: 'secondary' as const, label: '等待中' };
  return { dot: 'bg-gray-400', badge: 'secondary' as const, label: status || '-' };
}

function dsTone(status: string) {
  const s = (status || '').toLowerCase();
  if (s === 'success') return { badge: 'success' as const, label: '正常' };
  if (s === 'unknown') return { badge: 'secondary' as const, label: '未检测' };
  return { badge: 'destructive' as const, label: '异常' };
}

function formatDuration(ms?: number | null) {
  if (ms == null || ms < 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const data = await dashboardApi.stats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
      toast.error((error as Error).message || '加载仪表盘失败');
    } finally {
      setLoading(false);
    }
  };

  const summaryCards = [
    { label: '任务总数', value: stats?.summary?.totalJobs ?? 0, icon: GitBranch, color: 'text-blue-600', bg: 'bg-blue-50', href: '/jobs' },
    { label: '运行中', value: stats?.summary?.runningJobs ?? 0, icon: PlayCircle, color: 'text-green-600', bg: 'bg-green-50', href: '/jobs' },
    { label: '今日执行', value: stats?.summary?.todayExecutionCount ?? 0, icon: Activity, color: 'text-purple-600', bg: 'bg-purple-50', href: '/executions' },
    { label: '成功率', value: `${stats?.summary?.todaySuccessRate ?? 0}%`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', href: '/executions' },
    { label: '待处理死信', value: stats?.summary?.pendingDlq ?? 0, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', href: '/dead-letters' },
  ];

  const statusDistribution = Array.isArray(stats?.jobStatusDistribution) && stats.jobStatusDistribution.length
    ? stats.jobStatusDistribution
    : Object.entries(stats?.statusDistribution || {}).map(([status, value]) => ({
        name: status,
        value,
        status,
      }));

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
            <p className="text-sm text-muted-foreground">系统概览与运行状态总览</p>
          </div>
          <Button variant="secondary" onClick={loadStats} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.label} href={card.href}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{card.label}</p>
                        <p className="mt-1 text-2xl font-semibold">{card.value}</p>
                      </div>
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.bg}`}>
                        <Icon className={`h-5 w-5 ${card.color}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-medium">近 7 天执行趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats?.trendData || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(d) => String(d).slice(5)} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="success" name="成功" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="failed" name="失败" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="total" name="总数" stroke="#3b82f6" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">任务状态分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusDistribution} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={60} />
                    <Tooltip />
                    <Bar dataKey="value" name="任务数" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium">最近执行</CardTitle>
              <Link href="/executions" className="text-xs text-muted-foreground hover:text-foreground">查看全部</Link>
            </CardHeader>
            <CardContent className="p-0">
              {(stats?.recentExecutions || []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无执行记录</div>
              ) : (
                <div className="divide-y">
                  {stats.recentExecutions.slice(0, 6).map((exec: any) => {
                    const tone = execTone(exec.status);
                    return (
                      <div key={exec.id} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full ${tone.dot}`} />
                          <div>
                            <p className="text-sm font-medium">{exec.jobName || exec.jobId?.slice(0, 8)}</p>
                            <p className="text-xs text-muted-foreground">
                              {exec.startedAt ? new Date(exec.startedAt).toLocaleString('zh-CN') : '-'}
                              {exec.durationMs != null ? ` · ${formatDuration(exec.durationMs)}` : ''}
                            </p>
                          </div>
                        </div>
                        <Badge variant={tone.badge}>{tone.label}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium">数据源连通性</CardTitle>
              <Link href="/datasources" className="text-xs text-muted-foreground hover:text-foreground">管理</Link>
            </CardHeader>
            <CardContent className="p-0">
              {(stats?.datasourceHealth || []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无数据源</div>
              ) : (
                <div className="divide-y">
                  {stats.datasourceHealth.slice(0, 6).map((ds: any) => {
                    const tone = dsTone(ds.status);
                    return (
                      <div key={ds.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{ds.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {ds.type}
                            {ds.lastTestError ? ` · ${ds.lastTestError}` : ''}
                          </p>
                        </div>
                        <Badge variant={tone.badge}>{tone.label}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">近 24 小时最慢执行</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(stats?.topSlowestJobs || []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无耗时数据</div>
              ) : (
                <div className="divide-y">
                  {stats.topSlowestJobs.map((item: any) => {
                    const tone = execTone(item.status);
                    return (
                      <div key={item.executionId} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium">{item.jobName || item.jobId}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '-'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center text-xs text-muted-foreground">
                            <Clock className="mr-1 h-3 w-3" />
                            {formatDuration(item.durationMs)}
                          </span>
                          <Badge variant={tone.badge}>{tone.label}</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="mt-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <Gauge className="h-4 w-4" />
              运行指标
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              {stats?.metrics?.backend === 'prometheus_client' ? 'Prometheus' : '进程内计数'}
              {' · '}
              {stats?.metrics?.scrapePath || '/api/metrics'}
            </span>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">ETL 成功 / 失败</p>
                <p className="mt-1 text-lg font-semibold">
                  {stats?.metrics?.etlRuns?.success ?? 0}
                  <span className="text-muted-foreground"> / </span>
                  {stats?.metrics?.etlRuns?.failed ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">处理行数（成功）</p>
                <p className="mt-1 text-lg font-semibold">{stats?.metrics?.etlRows?.success ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">队列入队 / 深度</p>
                <p className="mt-1 text-lg font-semibold">
                  {stats?.metrics?.queueEnqueued ?? 0}
                  <span className="text-muted-foreground"> / </span>
                  {stats?.metrics?.queueDepth ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">SSO 登录次数</p>
                <p className="mt-1 text-lg font-semibold">
                  {Object.values(stats?.metrics?.ssoLogins || {}).reduce((sum: number, n: any) => sum + Number(n || 0), 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
