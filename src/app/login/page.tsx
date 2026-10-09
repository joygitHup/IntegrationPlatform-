'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { validateLoginForm } from '@/lib/login-form';
import { safeRedirectPath } from '@/lib/permissions';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GitBranch, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const { login, user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && user) {
      const searchParams = new URLSearchParams(window.location.search);
      const from = searchParams.get('from');
      const isOauth = searchParams.get('oauth') === '1';
      // OAuth 授权码流程：已登录用户直接带 token 跳回后端 /oauth/authorize
      if (isOauth && from) {
        const token = apiClient.getToken();
        if (token) {
          const sep = from.includes('?') ? '&' : '?';
          window.location.href = `${from}${sep}token=${encodeURIComponent(token)}`;
          return;
        }
      }
      router.replace(safeRedirectPath(from));
    }
  }, [authLoading, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = validateLoginForm(username, password);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      toast.error('请输入用户名和密码');
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await login(username, password);
      toast.success('登录成功');
    } catch (error) {
      toast.error((error as Error).message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <GitBranch className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">集成中台管理系统</h1>
          <p className="text-sm text-muted-foreground">Integration Platform Console</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>账号登录</CardTitle>
            <CardDescription>输入您的账号信息以访问管理后台</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  autoFocus
                  className={errors.username ? 'border-destructive' : ''}
                />
                {errors.username && <p className="text-xs text-destructive">{errors.username}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    className={errors.password ? 'border-destructive pr-9' : 'pr-9'}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    登录中...
                  </>
                ) : (
                  '登录'
                )}
              </Button>
            </form>

            <div className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">默认账号：</p>
              <p>管理员：admin / admin123</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
