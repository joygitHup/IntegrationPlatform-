'use client';

import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/app-layout';
import { auditLogsApi, fieldAuditApi, jobsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search,
  RefreshCw,
  Loader2,
  User,
  Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const ACTION_MAP: Record<string, { label: string; variant: string }> = {
  LOGIN: { label: '登录', variant: 'default' },
  LOGOUT: { label: '登出', variant: 'secondary' },
  CREATE: { label: '创建', variant: 'success' },
  UPDATE: { label: '更新', variant: 'warning' },
  DELETE: { label: '删除', variant: 'destructive' },
  EXECUTE: { label: '执行', variant: 'default' },
};

const RESOURCE_TYPE_MAP: Record<string, string> = {
  USER: '用户',
  DATASOURCE: '数据源',
  JOB: '任务',
  APP: '应用',
  EXECUTION: '执行',
  SYSTEM: '系统',
};

const FIELD_OP_MAP: Record<string, { label: string; variant: string }> = {
  create: { label: '新增', variant: 'success' },
  update: { label: '更新', variant: 'default' },
  delete: { label: '删除', variant: 'destructive' },
  skip_conflict: { label: '冲突跳过', variant: 'secondary' },
};

function actionLabel(log: any) {
  if (log.action === 'LOGIN' && log.detail && log.detail.success === false) {
    return { label: '登录失败', variant: 'destructive' };
  }
  return ACTION_MAP[log.action] || { label: log.action, variant: 'secondary' };
}

function fieldChangesOf(item: any): { field: string; oldValue: unknown; newValue: unknown }[] {
  if (Array.isArray(item?.changes) && item.changes.length > 0) {
    return item.changes.map((c: any) => ({
      field: c.field || c.name || '',
      oldValue: c.oldValue ?? c.old_value,
      newValue: c.newValue ?? c.new_value,
    }));
  }
  const oldV = item?.oldValues || item?.old_values || {};
  const newV = item?.newValues || item?.new_values || {};
  let fields = item?.changedFields || item?.changed_fields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch { fields = []; }
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    fields = [...new Set([...Object.keys(oldV || {}), ...Object.keys(newV || {})])];
  }
  return (fields as string[]).map((f) => ({ field: f, oldValue: oldV?.[f], newValue: newV?.[f] }));
}

export default function AuditLogsPage() {
  const [tab, setTab] = useState('ops');
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const [fieldLogs, setFieldLogs] = useState<any[]>([]);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [fieldPage, setFieldPage] = useState(1);
  const [fieldTotal, setFieldTotal] = useState(0);
  const [fieldJobId, setFieldJobId] = useState('');
  const [fieldExecutionId, setFieldExecutionId] = useState('');
  const [fieldRecordKey, setFieldRecordKey] = useState('');
  const [fieldOp, setFieldOp] = useState('');
  const [fieldDetail, setFieldDetail] = useState<any | null>(null);
  const [jobList, setJobList] = useState<any[]>([]);

  useEffect(() => {
    jobsApi.list({ pageSize: 100 }).then((r) => setJobList(r.items || [])).catch(() => setJobList([]));
  }, []);

  useEffect(() => {
    if (tab === 'ops') loadLogs();
  }, [action, resourceType, page, tab]);

  useEffect(() => {
    if (tab === 'fields') loadFieldLogs();
  }, [tab, fieldPage, fieldJobId, fieldOp]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (action) params.action = action;
      if (resourceType) params.resourceType = resourceType;
      if (keyword) params.keyword = keyword;
      const result = await auditLogsApi.list(params);
      setLogs(result.items || []);
      setTotal(result.total || 0);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadFieldLogs = async () => {
    setFieldLoading(true);
    try {
      const params: Record<string, any> = { page: fieldPage, pageSize };
      if (fieldJobId) params.jobId = fieldJobId;
      if (fieldExecutionId.trim()) params.executionId = fieldExecutionId.trim();
      if (fieldRecordKey.trim()) params.recordKey = fieldRecordKey.trim();
      if (fieldOp) params.operation = fieldOp;
      const result = await fieldAuditApi.list(params);
      setFieldLogs(result.items || []);
      setFieldTotal(result.total || 0);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setFieldLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    if (page === 1) loadLogs();
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const fieldTotalPages = Math.max(1, Math.ceil(fieldTotal / pageSize));
  const jobName = (id: string) => jobList.find((j) => j.id === id)?.name || id?.slice(0, 12) || '-';

  return (
    <AppLayout>
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">审计日志</h1>
            <p className="text-sm text-muted-foreground">操作行为与 ETL 字段变更</p>
          </div>
          <Button variant="secondary" onClick={tab === 'ops' ? loadLogs : loadFieldLogs}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="ops">操作日志</TabsTrigger>
            <TabsTrigger value="fields">字段变更</TabsTrigger>
          </TabsList>

          <TabsContent value="ops">
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="搜索用户名、资源名称或 IP..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    className="pl-9"
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  />
                </div>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部操作</option>
                  {Object.entries(ACTION_MAP).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={resourceType}
                  onChange={(e) => {
                    setResourceType(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部资源</option>
                  {Object.entries(RESOURCE_TYPE_MAP).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <Button variant="secondary" onClick={handleSearch}>搜索</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base font-medium">共 {total} 条记录</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : logs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    暂无审计记录
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left font-medium">时间</th>
                          <th className="px-4 py-3 text-left font-medium">操作人</th>
                          <th className="px-4 py-3 text-left font-medium">操作</th>
                          <th className="px-4 py-3 text-left font-medium">资源类型</th>
                          <th className="px-4 py-3 text-left font-medium">资源</th>
                          <th className="px-4 py-3 text-left font-medium">IP</th>
                          <th className="px-4 py-3 text-right font-medium">详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map((log) => {
                          const actionInfo = actionLabel(log);
                          return (
                            <tr key={log.id} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {log.createdAt ? new Date(log.createdAt).toLocaleString('zh-CN') : '-'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                                    <User className="h-3 w-3 text-primary" />
                                  </div>
                                  <span>{log.username || log.userId || '系统'}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={actionInfo.variant as any}>{actionInfo.label}</Badge>
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {RESOURCE_TYPE_MAP[log.resourceType] || log.resourceType || '-'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="max-w-[220px] truncate" title={log.resourceName || log.resourceId || ''}>
                                  {log.resourceName || log.resourceId || '-'}
                                </div>
                                {log.resourceName && log.resourceId && (
                                  <div className="font-mono text-xs text-muted-foreground truncate">{log.resourceId}</div>
                                )}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.ip || '-'}</td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => setDetail(log)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <div className="text-sm text-muted-foreground">
                      共 {total} 条，第 {page}/{totalPages} 页
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fields">
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <select
                  className="h-9 min-w-[160px] rounded-md border border-input bg-background px-3 text-sm"
                  value={fieldJobId}
                  onChange={(e) => { setFieldJobId(e.target.value); setFieldPage(1); }}
                >
                  <option value="">全部任务</option>
                  {jobList.map((j) => (
                    <option key={j.id} value={j.id}>{j.name}</option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={fieldOp}
                  onChange={(e) => { setFieldOp(e.target.value); setFieldPage(1); }}
                >
                  <option value="">全部操作</option>
                  {Object.entries(FIELD_OP_MAP).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                <Input
                  className="max-w-[200px]"
                  placeholder="执行 ID"
                  value={fieldExecutionId}
                  onChange={(e) => setFieldExecutionId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (fieldPage === 1 ? loadFieldLogs() : setFieldPage(1))}
                />
                <Input
                  className="max-w-[180px]"
                  placeholder="记录主键"
                  value={fieldRecordKey}
                  onChange={(e) => setFieldRecordKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (fieldPage === 1 ? loadFieldLogs() : setFieldPage(1))}
                />
                <Button variant="secondary" onClick={() => { setFieldPage(1); if (fieldPage === 1) loadFieldLogs(); }}>
                  搜索
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base font-medium">共 {fieldTotal} 条字段变更</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {fieldLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : fieldLogs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    暂无字段变更。任务需勾选「字段变更审计」，ETL 写入后会出现在这里。
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="px-4 py-3 text-left font-medium">时间</th>
                          <th className="px-4 py-3 text-left font-medium">任务</th>
                          <th className="px-4 py-3 text-left font-medium">记录键</th>
                          <th className="px-4 py-3 text-left font-medium">操作</th>
                          <th className="px-4 py-3 text-left font-medium">变更字段</th>
                          <th className="px-4 py-3 text-right font-medium">详情</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fieldLogs.map((item) => {
                          const op = FIELD_OP_MAP[item.operation] || { label: item.operation, variant: 'secondary' };
                          const changes = fieldChangesOf(item);
                          return (
                            <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {item.createdAt ? new Date(item.createdAt).toLocaleString('zh-CN') : '-'}
                              </td>
                              <td className="px-4 py-3">{jobName(item.jobId)}</td>
                              <td className="px-4 py-3 font-mono text-xs">{item.recordKey || '-'}</td>
                              <td className="px-4 py-3">
                                <Badge variant={op.variant as any}>{op.label}</Badge>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {changes.slice(0, 4).map((c) => c.field).filter(Boolean).join(', ') || '-'}
                                {changes.length > 4 ? ` +${changes.length - 4}` : ''}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setFieldDetail(item)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {fieldTotalPages > 1 && (
                  <div className="flex items-center justify-between border-t px-4 py-3">
                    <div className="text-sm text-muted-foreground">
                      共 {fieldTotal} 条，第 {fieldPage}/{fieldTotalPages} 页
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={fieldPage <= 1} onClick={() => setFieldPage((p) => p - 1)}>
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={fieldPage >= fieldTotalPages}
                        onClick={() => setFieldPage((p) => p + 1)}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>审计详情</DialogTitle>
            <DialogDescription>
              {detail?.id && `记录ID: ${detail.id}`}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 overflow-y-auto text-sm pr-1" style={{ maxHeight: '70vh' }}>
              {/* 摘要条 */}
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 overflow-hidden">
                <Badge variant={actionLabel(detail).variant as any} className="shrink-0">{actionLabel(detail).label}</Badge>
                <span className="shrink-0 text-muted-foreground">
                  {RESOURCE_TYPE_MAP[detail.resourceType] || detail.resourceType || '-'}
                </span>
                <span className="shrink-0 text-muted-foreground">·</span>
                <span className="font-medium truncate min-w-0">{detail.resourceName || detail.resourceId || '-'}</span>
              </div>

              {/* 信息网格 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <InfoItem label="操作人" value={detail.username || '-'} icon />
                <InfoItem label="IP 地址" value={detail.ip || '-'} mono />
                <InfoItem label="资源ID" value={detail.resourceId || '-'} mono />
                <InfoItem label="时间" value={detail.createdAt ? new Date(detail.createdAt).toLocaleString('zh-CN') : '-'} />
              </div>

              {/* 详细信息 */}
              {detail.detail && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">详细信息</p>
                  <pre className="max-h-60 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs leading-relaxed">
                    {typeof detail.detail === 'string' ? detail.detail : JSON.stringify(detail.detail, null, 2)}
                  </pre>
                </div>
              )}

              {/* User Agent */}
              {detail.userAgent && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">User Agent</p>
                  <pre className="max-h-20 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
                    {detail.userAgent}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!fieldDetail} onOpenChange={(o) => !o && setFieldDetail(null)}>
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>字段变更</DialogTitle>
            <DialogDescription>
              {fieldDetail?.recordKey ? `记录 ${fieldDetail.recordKey}` : fieldDetail?.id}
            </DialogDescription>
          </DialogHeader>
          {fieldDetail && (() => {
            const op = FIELD_OP_MAP[fieldDetail.operation] || { label: fieldDetail.operation, variant: 'secondary' };
            const changes = fieldChangesOf(fieldDetail);
            return (
              <div className="space-y-4 overflow-y-auto text-sm pr-1" style={{ maxHeight: '70vh' }}>
                {/* 摘要条 */}
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3 overflow-hidden">
                  <Badge variant={op.variant as any} className="shrink-0">{op.label}</Badge>
                  <span className="font-medium truncate min-w-0">{jobName(fieldDetail.jobId)}</span>
                  <span className="shrink-0 text-muted-foreground">·</span>
                  <span className="font-mono text-xs text-muted-foreground truncate min-w-0">{fieldDetail.executionId}</span>
                </div>

                {/* 变更表 */}
                <div className="max-h-96 overflow-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-4 py-2.5 text-left font-medium">字段</th>
                        <th className="px-4 py-2.5 text-left font-medium">变更前</th>
                        <th className="px-4 py-2.5 text-left font-medium">变更后</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map((c, i) => (
                        <tr key={`${c.field}-${i}`} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2 font-mono text-xs font-medium">{c.field}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground break-all">
                            {c.oldValue == null ? <span className="text-muted-foreground/50">—</span> : String(c.oldValue)}
                          </td>
                          <td className="px-4 py-2 text-xs break-all">
                            {c.newValue == null ? <span className="text-muted-foreground/50">—</span> : String(c.newValue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-xs text-muted-foreground">共 {changes.length} 个字段变更</p>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function InfoItem({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1.5 min-w-0 ${mono ? 'font-mono text-xs break-all' : 'truncate'}`}>
        {icon && <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        {value}
      </span>
    </div>
  );
}
