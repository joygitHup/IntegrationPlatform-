'use client';

import { useEffect, useState, useMemo } from 'react';
import { AppLayout } from '@/components/app-layout';
import { datasourcesApi, connectorsApi, openApi, type ConnectorMetadata } from '@/lib/api-client';
import {
  DATASOURCE_CODE_PATTERN,
  defaultsFromSchema,
  resolveConnectorList,
  suggestCode,
  validateConfigFields,
} from '@/lib/datasource-form';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Database,
  Plus,
  Search,
  Settings,
  Trash2,
  PlayCircle,
  Edit,
  Loader2,
  Server,
  Globe,
  MessageSquare,
  HardDrive,
  FileText,
  Cloud,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { DynamicConfigForm, type ConfigSchema } from '@/components/dynamic-config-form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const CATEGORY_LABEL: Record<string, string> = {
  database: '数据库',
  messaging: '消息队列',
  api: 'API 接口',
  file: '文件存储',
  saas: 'SaaS 应用',
};

const ICON_MAP: Record<string, typeof Database> = {
  database: Database,
  mysql: Database,
  postgres: Database,
  oracle: Database,
  sqlserver: Database,
  clickhouse: Database,
  messaging: MessageSquare,
  rabbitmq: MessageSquare,
  kafka: Server,
  rocketmq: MessageSquare,
  api: Globe,
  http_api: Globe,
  file: FileText,
  sftp: HardDrive,
  s3: Cloud,
  saas: Users,
  dingtalk: Users,
};

const CATEGORY_COLOR: Record<string, string> = {
  database: 'bg-blue-50 text-blue-600 border-blue-100',
  messaging: 'bg-orange-50 text-orange-600 border-orange-100',
  api: 'bg-green-50 text-green-600 border-green-100',
  file: 'bg-purple-50 text-purple-600 border-purple-100',
  saas: 'bg-pink-50 text-pink-600 border-pink-100',
};

export default function DatasourcesPage() {
  const { hasPermission } = useAuth();
  const [datasources, setDatasources] = useState<any[]>([]);
  const [connectors, setConnectors] = useState<ConnectorMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingConnectors, setLoadingConnectors] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('__all__');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', code: '', type: 'mysql', description: '', config: {} as Record<string, unknown>, clientId: '', environment: 'dev' });
  const [partners, setPartners] = useState<any[]>([]);
  const [codeTouched, setCodeTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadConnectors();
  }, [hasPermission]);

  useEffect(() => {
    if (connectors.length > 0) loadDatasources();
  }, [category, connectors.length]);

  const loadConnectors = async () => {
    try {
      const list = resolveConnectorList(await connectorsApi.list());
      setConnectors(list);
      if (hasPermission('open:manage')) {
        try {
          const clients = await openApi.clients.list();
          setPartners(clients.items || []);
        } catch {
          setPartners([]);
        }
      }
      setFormData((prev) => {
        if (list.some((c) => c.type === prev.type)) return prev;
        const first = list[0];
        if (!first) return prev;
        return { ...prev, type: first.type, config: defaultsFromSchema(first.configSchema) };
      });
    } catch (e) {
      toast.error('加载连接器列表失败');
    } finally {
      setLoadingConnectors(false);
    }
  };

  const loadDatasources = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { pageSize: 100 };
      if (category && category !== '__all__') {
        const types = connectors.filter(c => c.category === category).map(c => c.type);
        params.types = types.join(',');
      }
      if (keyword) params.keyword = keyword;
      const result = await datasourcesApi.list(params);
      setDatasources(result.items || []);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const currentConnector = useMemo(() => {
    return connectors.find(c => c.type === formData.type);
  }, [connectors, formData.type]);

  const groupedConnectors = useMemo(() => {
    const groups: Record<string, ConnectorMetadata[]> = {};
    for (const c of connectors) {
      if (!groups[c.category]) groups[c.category] = [];
      groups[c.category].push(c);
    }
    return groups;
  }, [connectors]);

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await datasourcesApi.testById(id);
      if (result.success) {
        toast.success('连接成功', { description: result.latencyMs != null ? `耗时: ${result.latencyMs}ms` : undefined });
      } else {
        toast.error('连接失败', { description: result.message });
      }
      loadDatasources();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const handleTestCurrent = async () => {
    const configSchema = currentConnector?.configSchema;
    if (!configSchema) return;
    const configErrors = validateConfigFields(configSchema, formData.config);
    if (Object.keys(configErrors).length > 0) {
      setFormErrors((prev) => ({ ...prev, ...configErrors }));
      toast.error('请先填写必填字段', { description: Object.values(configErrors).join('、') });
      setActiveTab('config');
      return;
    }
    setSubmitting(true);
    try {
      const result = await datasourcesApi.test({
        type: formData.type,
        config: formData.config,
        ...(editingItem?.id ? { id: editingItem.id } : {}),
      });
      if (result.success) {
        toast.success('连接成功', { description: result.latencyMs != null ? `耗时: ${result.latencyMs}ms` : undefined });
      } else {
        toast.error('连接失败', { description: result.message });
      }
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await datasourcesApi.delete(deleteId);
      toast.success('删除成功');
      loadDatasources();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  const openCreate = () => {
    const initialType = connectors.some((c) => c.type === 'mysql') ? 'mysql' : (connectors[0]?.type || 'mysql');
    const connector = connectors.find((c) => c.type === initialType);
    setEditingItem(null);
    setCodeTouched(false);
    setFormData({
      name: '',
      code: '',
      type: initialType,
      description: '',
      config: defaultsFromSchema(connector?.configSchema),
      clientId: '',
      environment: 'dev',
    });
    setFormErrors({});
    setActiveTab('basic');
    setDialogOpen(true);
  };

  const openEdit = async (item: any) => {
    setEditingItem(item);
    setCodeTouched(true);
    setFormErrors({});
    setActiveTab('basic');
    setDialogOpen(true);
    const connector = connectors.find((c) => c.type === item.type);
    setFormData({
      name: item.name,
      code: item.code,
      type: item.type,
      description: item.description || '',
      config: { ...defaultsFromSchema(connector?.configSchema), ...(item.config || {}) },
      clientId: item.clientId || '',
      environment: item.environment || 'dev',
    });
    try {
      const detail = await datasourcesApi.get(item.id);
      const detailConnector = connectors.find((c) => c.type === detail.type);
      setFormData({
        name: detail.name,
        code: detail.code,
        type: detail.type,
        description: detail.description || '',
        config: { ...defaultsFromSchema(detailConnector?.configSchema), ...(detail.config || {}) },
        clientId: detail.clientId || '',
        environment: detail.environment || 'dev',
      });
    } catch {
      // 详情失败时沿用列表数据
    }
  };

  const selectType = (type: string) => {
    const connector = connectors.find((c) => c.type === type);
    setFormData((prev) => ({
      ...prev,
      type,
      config: defaultsFromSchema(connector?.configSchema),
      code: codeTouched ? prev.code : (prev.name ? suggestCode(prev.name, type) : prev.code),
    }));
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next.type;
      return next;
    });
  };

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {};
    if (!formData.name.trim()) nextErrors.name = '请输入数据源名称';
    if (!formData.code.trim()) {
      nextErrors.code = '请输入数据源编码';
    } else if (!DATASOURCE_CODE_PATTERN.test(formData.code.trim())) {
      nextErrors.code = '编码只能以字母开头，可包含字母、数字、下划线和中划线';
    }
    const configErrors = validateConfigFields(currentConnector?.configSchema, formData.config);
    Object.assign(nextErrors, configErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      setActiveTab(nextErrors.name || nextErrors.code ? 'basic' : 'config');
      if (Object.keys(configErrors).length > 0 && !nextErrors.name && !nextErrors.code) {
        toast.error('请完善连接配置', { description: Object.values(configErrors).join('、') });
      }
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        type: formData.type,
        description: formData.description,
        config: formData.config,
        clientId: formData.clientId || '',
        environment: formData.environment || 'dev',
      };
      if (editingItem) {
        await datasourcesApi.update(editingItem.id, payload);
        toast.success('更新成功');
      } else {
        await datasourcesApi.create(payload);
        toast.success('创建成功');
      }
      setDialogOpen(false);
      loadDatasources();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const canWrite = hasPermission('datasource:write');

  const getTypeInfo = (type: string, ds: any) => {
    const c = connectors.find(c => c.type === type);
    const cat = c?.category || 'database';
    const color = CATEGORY_COLOR[cat] || 'bg-gray-100 text-gray-600 border-gray-100';
    const Icon = ICON_MAP[type] || ICON_MAP[cat] || Database;
    return { label: c?.name || type, color, Icon };
  };

  return (
    <AppLayout>
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">数据源管理</h1>
            <p className="text-sm text-muted-foreground">管理集成中台对接的各类数据源，支持 {connectors.length} 种连接器</p>
          </div>
          {canWrite && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              新建数据源
            </Button>
          )}
        </div>

        {/* 筛选栏 */}
        <Card className="mb-4">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索数据源名称或编码..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="pl-9"
                onKeyDown={(e) => e.key === 'Enter' && loadDatasources()}
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="全部类别" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">全部类别</SelectItem>
                {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="secondary" onClick={loadDatasources}>搜索</Button>
          </CardContent>
        </Card>

        {/* 列表 */}
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-medium">共 {datasources.length} 个数据源</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : datasources.length === 0 ? (
              <div className="py-16 text-center">
                <Database className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground mb-4">暂无数据源</p>
                {canWrite && (
                  <Button variant="outline" size="sm" onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" />创建第一个数据源
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="px-4 py-3 text-left font-medium">名称</th>
                      <th className="px-4 py-3 text-left font-medium">类型</th>
                      <th className="px-4 py-3 text-left font-medium">编码</th>
                      <th className="px-4 py-3 text-left font-medium">状态</th>
                      <th className="px-4 py-3 text-left font-medium">连通性测试</th>
                      <th className="px-4 py-3 text-left font-medium">创建时间</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasources.map((ds) => {
                      const { label, color, Icon } = getTypeInfo(ds.type, ds);
                      return (
                        <tr key={ds.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`flex h-8 w-8 items-center justify-center rounded-md border ${color}`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-medium">{ds.name}</p>
                                {ds.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-1 max-w-xs">{ds.description}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary">{label}</Badge>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{ds.code}</td>
                          <td className="px-4 py-3">
                            <Badge variant={ds.status === 'active' ? 'success' : 'secondary'}>
                              {ds.status === 'active' ? '启用' : '禁用'}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {ds.lastTestStatus ? (
                              <div className="flex items-center gap-1">
                                <span className={`h-2 w-2 rounded-full ${ds.lastTestStatus === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className="text-xs text-muted-foreground">
                                  {ds.lastTestStatus === 'success' ? '正常' : '失败'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">未测试</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {new Date(ds.createdAt).toLocaleString('zh-CN')}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => handleTest(ds.id)}
                                disabled={testingId === ds.id}
                                title="测试连接"
                              >
                                {testingId === ds.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <PlayCircle className="h-4 w-4" />
                                )}
                              </Button>
                              {canWrite && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={() => openEdit(ds)}
                                    title="编辑"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 px-2 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteId(ds.id)}
                                    title="删除"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !submitting && setDialogOpen(o)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? '编辑数据源' : '新建数据源'}</DialogTitle>
            <DialogDescription>
              配置数据源连接信息，支持测试连接验证连通性
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="config">连接配置</TabsTrigger>
            </TabsList>
            <TabsContent value="basic" className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    数据源名称 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setFormData((prev) => ({
                        ...prev,
                        name,
                        code: codeTouched ? prev.code : (name ? suggestCode(name, prev.type) : ''),
                      }));
                      if (formErrors.name) setFormErrors({ ...formErrors, name: '' });
                    }}
                    placeholder="请输入数据源名称"
                    className={formErrors.name ? 'border-red-300' : ''}
                  />
                  {formErrors.name && <p className="text-xs text-red-500">{formErrors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    数据源编码 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={formData.code}
                    onChange={(e) => {
                      setCodeTouched(true);
                      setFormData({ ...formData, code: e.target.value });
                      if (formErrors.code) setFormErrors({ ...formErrors, code: '' });
                    }}
                    disabled={!!editingItem}
                    placeholder="英文编码，如 mysql_prod"
                    className={`font-mono ${formErrors.code ? 'border-red-300' : ''}`}
                  />
                  {editingItem && <p className="text-xs text-muted-foreground">编码创建后不可修改</p>}
                  {formErrors.code && <p className="text-xs text-red-500">{formErrors.code}</p>}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  数据源类型 <span className="text-red-500">*</span>
                </label>
                {!editingItem ? (
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(groupedConnectors).map(([cat, list]) => (
                      <div key={cat} className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-blue-500" />
                          {CATEGORY_LABEL[cat]}
                        </p>
                        {list.map((c) => {
                          const Icon = ICON_MAP[c.type] || Database;
                          const selected = formData.type === c.type;
                          return (
                            <button
                              key={c.type}
                              type="button"
                              onClick={() => selectType(c.type)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${selected
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              <Icon className="h-4 w-4 flex-shrink-0" />
                              <span className="text-sm font-medium truncate">{c.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Badge variant="secondary" className="text-sm py-1 px-3">
                    {currentConnector?.name || formData.type}
                  </Badge>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">运行环境</label>
                <select
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={formData.environment || 'dev'}
                  onChange={(e) => setFormData({ ...formData, environment: e.target.value })}
                >
                  <option value="dev">dev</option>
                  <option value="staging">staging</option>
                  <option value="prod">prod</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">所属集成商</label>
                <select
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={formData.clientId || ''}
                  onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                >
                  <option value="">仅控制台可见（不开放给 Key）</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  指派后，该集成商的 API Key 可以看见并调用此数据源。
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="数据源用途说明（可选）"
                  rows={3}
                  className="w-full px-3 py-2 text-sm border rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </TabsContent>
            <TabsContent value="config" className="pt-4">
              {currentConnector ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {currentConnector.description}
                      </span>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleTestCurrent}>
                      <PlayCircle className="mr-2 h-4 w-4" />
                      测试连接
                    </Button>
                  </div>
                  <DynamicConfigForm
                    schema={currentConnector.configSchema as ConfigSchema}
                    values={formData.config}
                    onChange={(v) => {
                      setFormData({ ...formData, config: v });
                      setFormErrors((prev) => {
                        const next = { ...prev };
                        Object.keys(v).forEach((k) => {
                          if (next[k]) delete next[k];
                        });
                        return next;
                      });
                    }}
                    errors={formErrors}
                    disabled={submitting}
                  />
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  请先选择数据源类型
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingItem ? '保存修改' : '创建数据源'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，确定要删除此数据源吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
