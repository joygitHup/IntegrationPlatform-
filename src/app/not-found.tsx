'use client';

import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="flex flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
          <Compass className="h-8 w-8" />
        </div>
        <h1 className="text-7xl font-bold tracking-tight text-foreground">404</h1>
        <p className="mt-4 text-lg text-muted-foreground">页面不存在</p>
        <p className="mt-2 text-sm text-muted-foreground">
          您访问的页面可能已被移除或地址有误。
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
