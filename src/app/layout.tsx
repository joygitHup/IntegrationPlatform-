import type { Metadata } from 'next';
import './globals.css';
import { AppProviders } from '@/components/providers';

export const metadata: Metadata = {
  title: {
    default: '集成中台管理系统',
    template: '%s | 集成中台',
  },
  description: '企业级集成中台管理系统 - 统一管理多系统间的数据同步、接口集成与流程编排',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
