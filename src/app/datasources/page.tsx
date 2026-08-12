'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { datasourcesApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Database,
  Plus,
  Search,
  Settings,
  Trash2,
  PlayCircle,
  Edit,
  Loader2,
  Server,
  Globe,
  MessageSquare,
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

const DS_TYPE_MAP: Record<string, { label: string; icon: typeof Database; color: string }> = {
  mysql: { label: 'MySQL', icon: Database, color: 'bg-blue-50 text-blue-600' },
  postgres: { label: 'PostgreSQL', icon: Database, color: 'bg-indigo-50 text-indigo-600' },
  http_api: { label: 'HTTP API', icon: Globe, color: 'bg-green-50 text-green-600' },
  rabbitmq: { label: 'RabbitMQ', icon: MessageSquare, color: 'bg-orange-50 text-orange-600' },
  kafka: { label: 'Kafka', icon: Server, color: 'bg-gray-100 text-gray-700' },
  redis: { label: 'Redis', icon: Server, color: 'bg-red-50 text-red-600' },
};

export default function DatasourcesPage() {
  const { hasPermission } = useAuth();
  const [datasources, setDatasources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    loadDatasources();
  }, [type]);

  const loadDatasources = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { pageSize: 100 };
      if (type) params.type = type;
      if (keyword) params.keyword = keyword;
      const result = await datasourcesApi.list(params);
      setDatasources(result.items || []);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await datasourcesApi.testById(id);
      if (result.success) {
        toast.success(result.message, { description: `耗时: ${result.latencyMs}ms` });
      } else {
        toast.error('连接失败', { description: result.message });
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await datasourcesApi.delete(deleteId);
      toast.success('删除成功');
      loadDatasources();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  const canWrite = hasPermission('datasource:write');

  return (
    <AppLayout>
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">数据源管理</h1>
            <p className="text-sm text-muted-foreground">管理集成中台对接的各类数据源</p>
          </div>
          {canWrite && (
            <Button onClick={() => toast.info('新建功能开发中...')}>
              <Plus className="mr-2 h-4 w-4" />
              新建数据源
            </Button>
          )}
        </div>

        {/* 筛选栏 */}
        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索数据源名称或编码..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && loadDatasources()}
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">全部类型</option>
              {Object.entries(DS_TYPE_MAP).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={loadDatasources}>搜索</Button>
          </CardContent>
        </Card>

        {/* 列表 */}
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">共 {datasources.length} 个数据源</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : datasources.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无数据源
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">名称</th>
                      <th className="px-4 py-3 text-left font-medium">类型</th>
                      <th className="px-4 py-3 text-left font-medium">编码</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">连通性测试</th>
                      <th className="px-4 py-3 text-left font-medium">创建时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasources.map((ds) => {
                      const typeInfo = DS_TYPE_MAP[ds.type] || { label: ds.type, icon: Database, color: 'bg-gray-100 text-gray-600' };
                      const TypeIcon = typeInfo.icon;
                      return (
                        <tr key={ds.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`flex h-8 w-8 items-center justify-center rounded-md ${typeInfo.color}`}>
                                <TypeIcon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-medium">{ds.name}</p>
                                {ds.description && (
                                  <p className="text-xs text-muted-foreground">{ds.description}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary">{typeInfo.label}</Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{ds.code}</td>
                          <td className="px-4 py-3">
                            <Badge variant={ds.status === 'active' ? 'success' : 'secondary'}>
                              {ds.status === 'active' ? '启用' : '禁用'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {ds.lastTestStatus ? (
                              <div className="flex items-center gap-1">
                                <span className={`h-2 w-2 rounded-full ${ds.lastTestStatus === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className="text-xs text-muted-foreground">
                                  {ds.lastTestStatus === 'success' ? '正常' : '失败'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">未测试</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(ds.createdAt).toLocaleString('zh-CN')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => handleTest(ds.id)}
                                disabled={testingId === ds.id}
                              >
                                {testingId === ds.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <PlayCircle className="h-4 w-4" />
                                )}
                              </Button>
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
                                    onClick={() => setDeleteId(ds.id)}
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

      {/* 删除确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，确定要删除此数据源吗？
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
