'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Database,
  GitBranch,
  Activity,
  AlertTriangle,
  Users,
  FileText,
  Settings,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface SidebarItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: string;
}

const navItems: SidebarItem[] = [
  { label: '仪表盘', href: '/', icon: LayoutDashboard },
  { label: '数据源管理', href: '/datasources', icon: Database, permission: 'datasource:read' },
  { label: '集成任务', href: '/jobs', icon: GitBranch, permission: 'job:read' },
  { label: '执行监控', href: '/executions', icon: Activity, permission: 'execution:read' },
  { label: '死信队列', href: '/dead-letters', icon: AlertTriangle, permission: 'dlq:read' },
  { label: '用户管理', href: '/users', icon: Users, permission: 'user:read' },
  { label: '审计日志', href: '/audit-logs', icon: FileText, permission: 'audit:read' },
  { label: '系统设置', href: '/settings', icon: Settings, permission: '*' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout, hasPermission } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const visibleItems = navItems.filter(
    (item) => !item.permission || hasPermission(item.permission),
  );

  return (
    <aside
      className={cn(
        'flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GitBranch className="h-4 w-4" />
            </div>
            <span>集成中台</span>
          </Link>
        )}
        {collapsed && (
          <div className="flex w-full justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GitBranch className="h-4 w-4" />
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-1 px-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    collapsed && 'justify-center px-0',
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer - User & Collapse */}
      <div className="border-t p-3">
        {!collapsed ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {user?.username?.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.username}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.roleId}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-start px-2 text-destructive hover:text-destructive"
                onClick={logout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                退出
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => setCollapsed(true)}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => setCollapsed(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-sidebar-accent"
              title="展开"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
