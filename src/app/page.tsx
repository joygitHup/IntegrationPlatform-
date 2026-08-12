'use client';

import { useEffect, useState } from 'react';
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
import { RefreshCw } from 'lucide-react';

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
    } finally {
      setLoading(false);
    }
  };

  const summaryCards = [
    { label: '任务总数', value: stats?.summary?.totalJobs ?? 0, icon: GitBranch, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: '运行中', value: stats?.summary?.runningJobs ?? 0, icon: PlayCircle, color: 'text-green-600', bg: 'bg-green-50' },
    { label: '今日执行', value: stats?.summary?.todayExecutionCount ?? 0, icon: Activity, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: '成功率', value: `${stats?.summary?.todaySuccessRate ?? 0}%`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: '待处理死信', value: stats?.summary?.pendingDlq ?? 0, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

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

        {/* 统计卡片 */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <Card key={card.label}>
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
            );
          })}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 执行趋势图 */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base font-medium">近 7 天执行趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats?.trendData || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
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

          {/* 任务状态分布 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">任务状态分布</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats?.jobStatusDistribution || []} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={60} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* 最近执行 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">最近执行</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(stats?.recentExecutions || []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无执行记录</div>
              ) : (
                <div className="divide-y">
                  {stats?.recentExecutions?.slice(0, 5).map((exec: any) => (
                    <div key={exec.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-2 w-2 rounded-full ${
                          exec.status === 'SUCCESS' ? 'bg-green-500' :
                          exec.status === 'FAILED' ? 'bg-red-500' :
                          exec.status === 'RUNNING' ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'
                        }`} />
                        <div>
                          <p className="text-sm font-medium">{exec.jobName || exec.jobId?.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground">
                            {exec.startedAt ? new Date(exec.startedAt).toLocaleString('zh-CN') : '-'}
                          </p>
                        </div>
                      </div>
                      <Badge variant={
                        exec.status === 'SUCCESS' ? 'success' :
                        exec.status === 'FAILED' ? 'destructive' : 'secondary'
                      }>
                        {exec.status === 'SUCCESS' ? '成功' :
                         exec.status === 'FAILED' ? '失败' :
                         exec.status === 'RUNNING' ? '执行中' : exec.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 数据源状态 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">数据源连通性</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(stats?.datasourceHealth || []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">暂无数据源</div>
              ) : (
                <div className="divide-y">
                  {stats?.datasourceHealth?.slice(0, 5).map((ds: any) => (
                    <div key={ds.id} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{ds.name}</p>
                        <p className="text-xs text-muted-foreground">{ds.type}</p>
                      </div>
                      <Badge variant={ds.status === 'success' ? 'success' : 'destructive'}>
                        {ds.status === 'success' ? '正常' : '异常'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
