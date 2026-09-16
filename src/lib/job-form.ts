import { validateDagText } from '@/lib/dag';

/** 与后端 JOB_CODE_PATTERN / CreateJobSerializer 对齐 */
export const JOB_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export const DESENSITIZE_OPTIONS = [
  { value: 'auto', label: '智能识别（按字段名/内容选规则）' },
  { value: 'mask', label: '通用掩码' },
  { value: 'hash', label: '哈希' },
  { value: 'remove', label: '删除字段' },
  { value: 'phone', label: '手机号（保留前3后4）' },
  { value: 'email', label: '邮箱（保留首字符）' },
  { value: 'id_card', label: '身份证（保留前3后4）' },
  { value: 'bank_card', label: '银行卡（保留后4）' },
  { value: 'name', label: '姓名（保留姓）' },
  { value: 'address', label: '地址（保留前段）' },
  { value: 'keep_last4', label: '仅保留后4位' },
] as const;

export const TRANSFORM_OPTIONS = [
  { value: '', label: '直接映射' },
  { value: 'trim', label: '去除空白 (trim)' },
  { value: 'upper', label: '转大写 (upper)' },
  { value: 'lower', label: '转小写 (lower)' },
  { value: 'toInt', label: '转整数 (toInt)' },
  { value: 'toFloat', label: '转浮点数 (toFloat)' },
  { value: 'toString', label: '转字符串 (toString)' },
  { value: 'toDate', label: '转日期 (toDate)' },
  { value: 'defaultValue', label: '默认值填充' },
  { value: 'statusMap', label: '状态映射 (statusMap)' },
  { value: 'custom', label: '自定义表达式' },
] as const;

export interface FieldMapping {
  source: string;
  target: string;
  transform: string;
  defaultValue: string;
  required: boolean;
  params?: Record<string, unknown>;
}

export const defaultMapping: FieldMapping = {
  source: '',
  target: '',
  transform: '',
  defaultValue: '',
  required: false,
};

export interface JobForm {
  name: string;
  code: string;
  description: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  syncMode: string;
  watermarkField: string;
  scheduleType: string;
  scheduleCron: string;
  batchSize: number;
  retryCount: number;
  retryInterval: number;
  sourceTable: string;
  targetTable: string;
  fieldMapping: FieldMapping[];
  filterCondition: string;
  callbackUrl: string;
  webhookSecret: string;
  alertEmail: string;
  alertWebhookUrl: string;
  enableVersionSnapshot: boolean;
  environment: string;
  syncDirection: string;
  originMarkerField: string;
  originSystemId: string;
  pairJobId: string;
  dagSteps: string;
  clientId: string;
  writeMode: string;
  matchKeys: string;
  conflictStrategy: string;
  conflictCompareField: string;
  sensitiveFields: string;
  desensitizeMode: string;
  enableChangeAudit: boolean;
  templateType: string;
}

export const emptyJobForm: JobForm = {
  name: '',
  code: '',
  description: '',
  sourceDatasourceId: '',
  targetDatasourceId: '',
  syncMode: 'full',
  watermarkField: '',
  scheduleType: 'manual',
  scheduleCron: '0 */5 * * * *',
  batchSize: 1000,
  retryCount: 3,
  retryInterval: 60,
  sourceTable: '',
  targetTable: '',
  fieldMapping: [{ ...defaultMapping }],
  filterCondition: '',
  callbackUrl: '',
  webhookSecret: '',
  alertEmail: '',
  alertWebhookUrl: '',
  enableVersionSnapshot: false,
  environment: 'dev',
  syncDirection: 'forward',
  originMarkerField: '_ip_origin',
  originSystemId: '',
  pairJobId: '',
  dagSteps: '',
  clientId: '',
  writeMode: 'insert',
  matchKeys: '',
  conflictStrategy: 'source_wins',
  conflictCompareField: '',
  sensitiveFields: '',
  desensitizeMode: 'mask',
  enableChangeAudit: false,
  templateType: '',
};

export function connectorSupportsIncremental(meta?: {
  features?: { incrementalRead?: boolean };
  capabilities?: { supportsIncremental?: boolean };
} | null): boolean {
  if (!meta) return true;
  if (typeof meta.features?.incrementalRead === 'boolean') return meta.features.incrementalRead;
  if (typeof meta.capabilities?.supportsIncremental === 'boolean') return meta.capabilities.supportsIncremental;
  return true;
}

export function connectorSupportsUpsert(meta?: {
  features?: { upsertSupport?: boolean };
  capabilities?: { supportsUpsert?: boolean };
} | null): boolean {
  if (!meta) return true;
  if (typeof meta.features?.upsertSupport === 'boolean') return meta.features.upsertSupport;
  if (typeof meta.capabilities?.supportsUpsert === 'boolean') return meta.capabilities.supportsUpsert;
  return true;
}

export function suggestJobCode(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (JOB_CODE_PATTERN.test(ascii)) {
    return ascii.slice(0, 64);
  }
  const suffix = Date.now().toString(36);
  return `job_${suffix}`.slice(0, 64);
}

export function formFromJobDetail(detail: any): JobForm {
  const mappings = Array.isArray(detail?.fieldMapping) ? detail.fieldMapping : [];
  return {
    name: detail?.name || '',
    code: detail?.code || '',
    description: detail?.description || '',
    sourceDatasourceId: detail?.sourceDatasourceId || '',
    targetDatasourceId: detail?.targetDatasourceId || '',
    syncMode: detail?.syncMode || 'full',
    watermarkField: detail?.watermarkField || '',
    scheduleType: detail?.scheduleType || 'manual',
    scheduleCron: detail?.scheduleCron || (detail?.scheduleType === 'event' ? 'job.completed' : '0 */5 * * * *'),
    batchSize: detail?.batchSize || 1000,
    retryCount: detail?.retryCount ?? 3,
    retryInterval: detail?.retryInterval ?? 60,
    sourceTable: detail?.sourceConfig?.table || detail?.sourceConfig?.path || '',
    targetTable: detail?.targetConfig?.table || detail?.targetConfig?.path || '',
    fieldMapping: mappings.length
      ? mappings.map((m: any) => ({
          source: m.source || '',
          target: m.target || '',
          transform: m.transform === 'none' ? '' : (m.transform || ''),
          defaultValue: m.defaultValue ?? m.default_value ?? '',
          required: Boolean(m.required),
          params: m.params && typeof m.params === 'object' ? m.params : undefined,
        }))
      : [{ ...defaultMapping }],
    filterCondition: detail?.filterCondition || '',
    callbackUrl: detail?.callbackUrl || '',
    webhookSecret: detail?.webhookSecret || '',
    alertEmail: detail?.alertEmail || '',
    alertWebhookUrl: detail?.alertWebhookUrl || '',
    enableVersionSnapshot: Boolean(detail?.enableVersionSnapshot),
    environment: detail?.environment || 'dev',
    syncDirection: detail?.syncDirection || 'forward',
    originMarkerField: detail?.originMarkerField || '_ip_origin',
    originSystemId: detail?.originSystemId || '',
    pairJobId: detail?.pairJobId || '',
    dagSteps: Array.isArray(detail?.dagSteps) && detail.dagSteps.length
      ? JSON.stringify(detail.dagSteps, null, 2)
      : '',
    clientId: detail?.clientId || '',
    writeMode: detail?.writeMode || 'insert',
    matchKeys: Array.isArray(detail?.matchKeys) ? detail.matchKeys.join(',') : (detail?.matchKeys || ''),
    conflictStrategy: detail?.conflictStrategy || 'source_wins',
    conflictCompareField: detail?.conflictCompareField || '',
    sensitiveFields: Array.isArray(detail?.sensitiveFields) ? detail.sensitiveFields.join(',') : (detail?.sensitiveFields || ''),
    desensitizeMode: detail?.desensitizeMode || 'mask',
    enableChangeAudit: Boolean(detail?.enableChangeAudit),
    templateType: detail?.templateType || '',
  };
}

export function validateJobForm(form: JobForm): { errors: Record<string, string>; tab: string } {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = '请输入任务名称';
  if (!form.code.trim()) {
    errors.code = '请输入任务编码';
  } else if (!JOB_CODE_PATTERN.test(form.code.trim())) {
    errors.code = '编码只能以字母开头，可包含字母、数字、下划线和中划线';
  }
  if (!form.sourceDatasourceId && !form.dagSteps.trim() && form.scheduleType !== 'webhook') {
    errors.sourceDatasourceId = '请选择源数据源';
  }
  if (!form.targetDatasourceId && !form.dagSteps.trim()) errors.targetDatasourceId = '请选择目标数据源';
  if (form.syncMode === 'incremental' && !form.watermarkField.trim()) {
    errors.watermarkField = '增量同步需指定水位字段';
  }
  const hasValid = form.fieldMapping.some((m) => m.source.trim() && m.target.trim());
  let dagOk = false;
  if (form.dagSteps.trim()) {
    const dagError = validateDagText(form.dagSteps);
    if (dagError) errors.dagSteps = dagError;
    else dagOk = true;
  }
  if (!hasValid && !dagOk) errors.fieldMapping = '至少配置一条有效的字段映射，或编排 DAG 步骤';
  if (form.scheduleType === 'cron') {
    if (!form.scheduleCron.trim()) {
      errors.scheduleCron = '请输入 Cron 表达式';
    } else {
      const parts = form.scheduleCron.trim().split(/\s+/);
      if (parts.length !== 5 && parts.length !== 6) {
        errors.scheduleCron = 'Cron 表达式应为 5 或 6 段';
      }
    }
  }
  if (form.scheduleType === 'event' && !form.scheduleCron.trim()) {
    errors.scheduleCron = '请填写要监听的事件名，例如 job.completed';
  }
  if (!Number.isFinite(form.batchSize) || form.batchSize < 1) {
    errors.batchSize = '批次大小至少为 1';
  }
  if (!Number.isFinite(form.retryCount) || form.retryCount < 0) {
    errors.retryCount = '重试次数不能为负';
  }
  if (!Number.isFinite(form.retryInterval) || form.retryInterval < 0) {
    errors.retryInterval = '重试间隔不能为负';
  }

  let tab = 'basic';
  if (errors.dagSteps) tab = 'dag';
  else if (errors.fieldMapping) tab = 'mapping';
  else if (errors.scheduleCron || errors.batchSize || errors.retryCount || errors.retryInterval) tab = 'schedule';
  else if (errors.name || errors.code || errors.sourceDatasourceId || errors.targetDatasourceId || errors.watermarkField) {
    tab = 'basic';
  }
  return { errors, tab };
}

export function buildJobPayload(form: JobForm): Record<string, unknown> {
  return {
    name: form.name.trim(),
    code: form.code.trim(),
    description: form.description.trim(),
    sourceDatasourceId: form.sourceDatasourceId,
    targetDatasourceId: form.targetDatasourceId,
    syncMode: form.syncMode,
    watermarkField: form.syncMode === 'incremental' ? form.watermarkField.trim() : '',
    scheduleType: form.scheduleType,
    scheduleCron: form.scheduleType === 'cron' || form.scheduleType === 'event' ? form.scheduleCron.trim() : '',
    batchSize: Number(form.batchSize) || 1000,
    retryCount: Number(form.retryCount) || 0,
    retryInterval: Number(form.retryInterval) || 60,
    filterCondition: form.filterCondition.trim(),
    callbackUrl: form.callbackUrl.trim(),
    alertEmail: form.alertEmail.trim(),
    alertWebhookUrl: form.alertWebhookUrl.trim(),
    enableVersionSnapshot: form.enableVersionSnapshot,
    enableChangeAudit: form.enableChangeAudit,
    environment: form.environment || 'dev',
    syncDirection: form.syncDirection || 'forward',
    originMarkerField: form.originMarkerField.trim() || '_ip_origin',
    originSystemId: form.originSystemId.trim(),
    pairJobId: form.pairJobId.trim(),
    clientId: form.clientId || '',
    writeMode: form.writeMode || 'insert',
    matchKeys: form.matchKeys.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
    conflictStrategy: form.conflictStrategy || 'source_wins',
    conflictCompareField: form.conflictCompareField.trim(),
    sensitiveFields: form.sensitiveFields.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
    desensitizeMode: form.desensitizeMode || 'mask',
    templateType: form.templateType || '',
    dagSteps: (() => {
      if (!form.dagSteps.trim()) return [];
      try {
        const parsed = JSON.parse(form.dagSteps);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
    sourceConfig: form.sourceTable.trim() ? { table: form.sourceTable.trim(), path: form.sourceTable.trim() } : {},
    targetConfig: form.targetTable.trim() ? { table: form.targetTable.trim(), path: form.targetTable.trim() } : {},
    fieldMapping: form.fieldMapping
      .filter((m) => m.source.trim() && m.target.trim())
      .map((m) => {
        const row: Record<string, unknown> = {
          source: m.source.trim(),
          target: m.target.trim(),
        };
        if (m.transform) row.transform = m.transform;
        if (m.defaultValue) row.defaultValue = m.defaultValue;
        if (m.required) row.required = true;
        if (m.params && Object.keys(m.params).length) row.params = m.params;
        return row;
      }),
  };
}
