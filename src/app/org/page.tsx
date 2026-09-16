'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { jobsApi } from '@/lib/api-client';
import { OrgTreePanel } from '@/components/org-tree';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Network, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function OrgPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobId, setJobId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const fromUrl = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('jobId') || ''
      : '';
    jobsApi.list({ pageSize: 100 }).then((result) => {
      const items = result.items || [];
      setJobs(items);
      setJobId((prev) => prev || fromUrl || items[0]?.id || '');
    }).catch((error) => toast.error((error as Error).message));
  }, []);

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">组织架构</h1>
            <p className="text-sm text-muted-foreground">
              身份源拉通讯录后写入的部门树与人-部门关系
            </p>
          </div>
          <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)} disabled={!jobId}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>

        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Network className="h-4 w-4 text-muted-foreground" />
            <select
              className="h-9 min-w-[240px] rounded-md border border-input bg-background px-3 text-sm"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              {jobs.length === 0 && <option value="">暂无任务</option>}
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>{job.name}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">按任务查看已同步的部门</span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            {jobId ? (
              <OrgTreePanel key={`${jobId}-${reloadKey}`} jobId={jobId} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">请选择任务</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
