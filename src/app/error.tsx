'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-lg">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">出错了</h1>
        <p className="mt-3 break-words text-sm text-muted-foreground">
          {error?.message || '应用遇到未知问题，请稍后重试。'}
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Button onClick={() => router.refresh()}>刷新页面</Button>
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-6 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
