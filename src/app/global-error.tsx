'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global application error:', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(to bottom right, #f8fafc, #f1f5f9)',
          padding: '1rem',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            maxWidth: '28rem',
            width: '100%',
          }}
        >
          <div
            style={{
              marginBottom: '1.5rem',
              width: '4rem',
              height: '4rem',
              borderRadius: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#dc2626',
              color: '#ffffff',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
              fontSize: '1.75rem',
              fontWeight: 700,
            }}
          >
            !
          </div>
          <h1
            style={{
              fontSize: '1.875rem',
              fontWeight: 600,
              letterSpacing: '-0.025em',
              color: '#0f172a',
              margin: 0,
            }}
          >
            应用发生严重错误
          </h1>
          <p
            style={{
              marginTop: '0.75rem',
              fontSize: '0.875rem',
              color: '#64748b',
              wordBreak: 'break-word',
            }}
          >
            {error?.message || '根布局发生未捕获错误，请重试或联系管理员。'}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: '2rem',
              height: '2.5rem',
              padding: '0 1.5rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: '#2563eb',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            }}
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
