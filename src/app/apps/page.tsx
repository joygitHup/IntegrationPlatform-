'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { appsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Search,
  ExternalLink,
  Lock,
  Grid3X3,
  Loader2,
  BarChart3,
  Briefcase,
  Cpu,
  FolderKanban,
  Mail,
  BookOpen,
  Users,
  Settings,
} from 'lucide-react';
import { toast } from 'sonner';

const categoryMap: Record<string, { label: string; icon: typeof Briefcase }> = {
  business: { label: '业务系统', icon: Briefcase },
  data: { label: '数据平台', icon: BarChart3 },
  devops: { label: '研发运维', icon: Cpu },
  collaboration: { label: '协同办公', icon: Users },
  other: { label: '其他', icon: FolderKanban },
};

const loginTypeLabels: Record<string, { label: string; variant: string }> = {
  jwt: { label: 'JWT 免密', variant: 'default' },
  ticket: { label: '一次性票据', variant: 'secondary' },
  oauth2: { label: 'OAuth2', variant: 'outline' },
  saml: { label: 'SAML', variant: 'destructive' },
  form_based: { label: '表单代填', variant: 'secondary' },
};

export default function AppsPortalPage() {
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string>('__all__');
  const [launching, setLaunching] = useState<string | null>(null);
  const [bindApp, setBindApp] = useState<any | null>(null);
  const [bindUser, setBindUser] = useState('');
  const [bindPass, setBindPass] = useState('');
  const [bindSaving, setBindSaving] = useState(false);

  useEffect(() => {
    loadApps();
  }, []);

  const loadApps = async () => {
    setLoading(true);
    try {
      const result = await appsApi.my();
      setApps(result.items || []);
    } catch (error) {
      console.error('Failed to load apps:', error);
      toast.error('加载应用列表失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredApps = apps.filter((app) => {
    if (category !== '__all__' && app.category !== category) return false;
    if (keyword && !app.name?.toLowerCase().includes(keyword.toLowerCase())) return false;
    return true;
  });

  const categories = Array.from(new Set(apps.map((a) => a.category).filter(Boolean)));

  const openAutoSubmit = (html: string) => {
    const win = window.open('', '_blank');
    if (!win) {
      toast.error('浏览器拦截了弹窗，请允许后重试');
      return false;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    return true;
  };

  const handleLaunch = async (app: any) => {
    setLaunching(app.id);
    try {
      const result = await appsApi.ssoLogin(app.id);
      if (result.needBinding || (result.type === 'form_based' && !result.html)) {
        setBindApp(app);
        setBindUser('');
        setBindPass('');
        toast.info(result.error || '请先绑定该应用的账号密码');
        return;
      }
      if (result.type === 'form_based' && result.html) {
        if (openAutoSubmit(result.html)) {
          toast.success(`正在代填登录 ${app.name}...`);
        }
        return;
      }
      const targetUrl = result.url || result.loginUrl || result.authorizeUrl;
      if (targetUrl) {
        window.open(targetUrl, '_blank');
        toast.success(`正在跳转到 ${app.name}...`);
      } else {
        toast.info('请在新页面中完成登录');
      }
    } catch (error: any) {
      toast.error(error.message || '启动应用失败');
    } finally {
      setLaunching(null);
    }
  };

  const submitBinding = async () => {
    if (!bindApp) return;
    if (!bindUser.trim() || !bindPass) {
      toast.error('请填写账号和密码');
      return;
    }
    setBindSaving(true);
    try {
      await appsApi.bindings.create({
        appId: bindApp.id,
        credentials: { username: bindUser.trim(), password: bindPass },
        externalUsername: bindUser.trim(),
      });
      setBindApp(null);
      toast.success('已绑定，正在代填登录');
      await handleLaunch(bindApp);
    } catch (error: any) {
      toast.error(error.message || '绑定失败');
    } finally {
      setBindSaving(false);
    }
  };

  const getCategoryIcon = (cat: string) => {
    return categoryMap[cat]?.icon || Grid3X3;
  };

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">应用门户</h1>
          <p className="mt-1 text-sm text-muted-foreground">快速访问已授权的企业应用</p>
        </div>

        {/* 搜索和筛选栏 */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索应用..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={category === '__all__' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategory('__all__')}
            >
              全部
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={category === cat ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategory(cat)}
              >
                {categoryMap[cat]?.label || cat}
              </Button>
            ))}
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          共 {filteredApps.length} 个应用
        </div>
      </div>

      {/* 应用卡片网格 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Grid3X3 className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">暂无可用应用</p>
          <p className="text-sm text-muted-foreground/70">请联系管理员开通应用访问权限</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredApps.map((app) => {
            const Icon = getCategoryIcon(app.category);
            const typeInfo = loginTypeLabels[app.loginType] || { label: app.loginType, variant: 'outline' };
            const isBound = app.isBound;

            return (
              <Card
                key={app.id}
                className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/50"
                onClick={() => handleLaunch(app)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                      {app.icon ? (
                        <span>{app.icon}</span>
                      ) : (
                        <Icon className="h-6 w-6 text-primary" />
                      )}
                    </div>
                    <Badge variant={typeInfo.variant as any} className="text-xs">
                      {typeInfo.label}
                    </Badge>
                  </div>
                  <CardTitle className="mt-3 text-base">{app.name}</CardTitle>
                  <CardDescription className="line-clamp-2 text-xs">
                    {app.description || '暂无描述'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs">
                      {isBound ? (
                        <Badge variant="success" className="text-xs">
                          已绑定
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          <Lock className="mr-1 h-3 w-3" />
                          未绑定
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLaunch(app);
                      }}
                      disabled={launching === app.id}
                    >
                      {launching === app.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-1 h-3 w-3" />
                      )}
                      打开
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(bindApp)} onOpenChange={(open) => { if (!open) setBindApp(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>绑定 {bindApp?.name} 账号</DialogTitle>
            <DialogDescription>
              表单代填会把账号密码提交到对方登录页，仅保存在本平台加密存储中。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>对方系统账号</Label>
              <Input
                value={bindUser}
                onChange={(e) => setBindUser(e.target.value)}
                placeholder="用户名"
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label>对方系统密码</Label>
              <Input
                type="password"
                value={bindPass}
                onChange={(e) => setBindPass(e.target.value)}
                placeholder="密码"
                autoComplete="current-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBindApp(null)}>取消</Button>
            <Button onClick={submitBinding} disabled={bindSaving}>
              {bindSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              绑定并打开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </AppLayout>
  );
}
