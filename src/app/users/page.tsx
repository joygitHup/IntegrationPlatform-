'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { usersApi } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Users,
  Plus,
  Search,
  Loader2,
  User,
  Shield,
  Edit,
  Trash2,
  Eye,
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
  active: { label: '启用', variant: 'success' },
  disabled: { label: '禁用', variant: 'destructive' },
  locked: { label: '锁定', variant: 'warning' },
};

export default function UsersPage() {
  const { hasPermission, user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, [status]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { pageSize: 100 };
      if (status) params.status = status;
      if (keyword) params.keyword = keyword;
      const result = await usersApi.list(params);
      setUsers(result.items || []);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await usersApi.delete(deleteId);
      toast.success('删除成功');
      loadUsers();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  const canWrite = hasPermission('user:write');

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
            <p className="text-sm text-muted-foreground">管理平台用户、角色与权限</p>
          </div>
          {canWrite && (
            <Button onClick={() => toast.info('新建功能开发中...')}>
              <Plus className="mr-2 h-4 w-4" />
              新建用户
            </Button>
          )}
        </div>

        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索用户名或邮箱..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
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
            <Button variant="secondary" onClick={loadUsers}>搜索</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base font-medium">共 {users.length} 位用户</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : users.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                暂无用户
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">用户</th>
                      <th className="px-4 py-3 text-left font-medium">角色</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">最后登录</th>
                      <th className="px-4 py-3 text-left font-medium">创建时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const statusInfo = STATUS_MAP[u.status] || { label: u.status, variant: 'secondary' };
                      return (
                        <tr key={u.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                                <User className="h-4 w-4 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">{u.displayName || u.username}</p>
                                <p className="text-xs text-muted-foreground">{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="flex w-fit items-center gap-1">
                              <Shield className="h-3 w-3" />
                              {u.roleCode === 'admin' ? '超级管理员' :
                               u.roleCode === 'developer' ? '开发者' :
                               u.roleCode === 'operator' ? '运维' :
                               u.roleCode === 'viewer' ? '只读用户' : u.roleCode}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusInfo.variant as any}>{statusInfo.label}</Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(u.createdAt).toLocaleString('zh-CN')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" className="h-8 px-2">
                                <Eye className="h-4 w-4" />
                              </Button>
                              {canWrite && u.id !== currentUser?.id && (
                                <>
                                  <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => toast.info('编辑功能开发中...')}>
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteId(u.id)}
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
              删除后用户账号将无法恢复，确定要删除此用户吗？
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
