'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiClient, authApi } from '@/lib/api-client';
import { useRouter, usePathname } from 'next/navigation';

interface User {
  id: string;
  username: string;
  roleId: string;
  permissions: string[];
  displayName?: string;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
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
        if (!PUBLIC_PATHS.includes(pathname)) {
          router.push('/login');
        }
        return;
      }

      apiClient.setToken(token);

      try {
        const result = await authApi.me();
        setUser(result.user);
      } catch {
        apiClient.clearToken();
        if (!PUBLIC_PATHS.includes(pathname)) {
          router.push('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, [pathname, router]);

  const login = async (username: string, password: string) => {
    const result = await authApi.login({ username, password });
    apiClient.setToken(result.accessToken);
    localStorage.setItem('refresh_token', result.refreshToken);
    setUser(result.user);
    router.push('/');
  };

  const logout = () => {
    apiClient.clearToken();
    setUser(null);
    router.push('/login');
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    if (user.roleId === 'admin') return true;
    return user.permissions.includes(permission) || user.permissions.includes('*');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission }}>
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
