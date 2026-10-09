'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiClient, authApi } from '@/lib/api-client';
import { hasPermission as checkPermission, safeRedirectPath } from '@/lib/permissions';
import { useRouter, usePathname } from 'next/navigation';

interface User {
  id: string;
  username: string;
  roleId: string | null;
  permissions: string[];
  displayName?: string | null;
  email?: string | null;
  roleCode?: string;
  roleName?: string;
  status?: string;
  lastLoginAt?: string | null;
  /** 所属集成客户 client_id；空串表示平台账号 */
  clientId?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const PUBLIC_PATHS = ['/login', '/register'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('access_token');
      if (!token) {
        setLoading(false);
        return;
      }

      apiClient.setToken(token);

      try {
        const result = await authApi.me();
        setUser(result.user);
      } catch {
        apiClient.clearToken();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  useEffect(() => {
    if (loading) return;
    const isPublic = PUBLIC_PATHS.includes(pathname);
    if (!user && !isPublic) {
      const from = pathname && pathname !== '/' ? `?from=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${from}`);
    }
  }, [loading, user, pathname, router]);

  const login = async (username: string, password: string) => {
    const result = await authApi.login({ username: username.trim(), password });
    apiClient.setToken(result.accessToken);
    localStorage.setItem('refresh_token', result.refreshToken);
    if (result.user?.permissions) {
      setUser(result.user);
    } else {
      const meResult = await authApi.me();
      setUser(meResult.user);
    }
    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const from = searchParams?.get('from') || null;
    const isOauth = searchParams?.get('oauth') === '1';
    // OAuth 授权码流程：带 token 跳回后端 /oauth/authorize 完成授权
    if (isOauth && from) {
      const sep = from.includes('?') ? '&' : '?';
      window.location.href = `${from}${sep}token=${encodeURIComponent(result.accessToken)}`;
      return;
    }
    router.push(safeRedirectPath(from));
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // 本地退出仍需清理
    }
    apiClient.clearToken();
    setUser(null);
    router.push('/login');
  };

  const changePassword = async (oldPassword: string, newPassword: string) => {
    await authApi.changePassword({ oldPassword, newPassword });
  };

  const hasPermission = (permission: string): boolean => checkPermission(user, permission);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
