import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.dev.coze.site'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
  async rewrites() {
    if (process.env.NEXT_PUBLIC_API_BASE) return [];
    const django = (process.env.DJANGO_API_BASE || 'http://127.0.0.1:8000/api').replace(/\/+$/, '');
    return [
      { source: '/api/metrics', destination: `${django}/metrics` },
      { source: '/api/workflows', destination: `${django}/workflows` },
    ];
  },
};

export default nextConfig;
