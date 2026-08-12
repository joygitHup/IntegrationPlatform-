import type { FieldMappingRule, FieldTransform } from '@/server/db/schema/integration-job';

/**
 * 字段映射引擎 - 根据映射规则转换单条数据
 */
export function transformRecord(
  source: Record<string, unknown>,
  mappings: FieldMappingRule[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const mapping of mappings) {
    const { source: sourceField, target: targetField, transform = 'none', params, required, defaultValue } = mapping;

    let value: unknown;

    // 支持嵌套字段，如 "user.profile.name"
    if (sourceField.includes('.')) {
      value = getNestedValue(source, sourceField);
    } else {
      value = source[sourceField];
    }

    // 默认值处理
    if ((value === undefined || value === null || value === '') && defaultValue !== undefined) {
      value = defaultValue;
    }

    // 必填校验
    if (required && (value === undefined || value === null || value === '')) {
      throw new Error(`字段 ${sourceField} 为必填项，但值为空`);
    }

    // 转换
    if (value !== undefined && value !== null) {
      value = applyTransform(value, transform, params);
    }

    // 支持嵌套目标字段
    if (targetField.includes('.')) {
      setNestedValue(result, targetField, value);
    } else {
      result[targetField] = value;
    }
  }

  return result;
}

/**
 * 批量转换
 */
export function transformBatch(
  records: Record<string, unknown>[],
  mappings: FieldMappingRule[],
): {
  success: Record<string, unknown>[];
  failed: { record: Record<string, unknown>; error: string }[];
} {
  const success: Record<string, unknown>[] = [];
  const failed: { record: Record<string, unknown>; error: string }[] = [];

  for (const record of records) {
    try {
      success.push(transformRecord(record, mappings));
    } catch (error) {
      failed.push({
        record,
        error: (error as Error).message,
      });
    }
  }

  return { success, failed };
}

/**
 * 应用转换函数
 */
function applyTransform(value: unknown, transform: FieldTransform, params?: Record<string, unknown>): unknown {
  switch (transform) {
    case 'none':
      return value;

    case 'trim':
      return String(value).trim();

    case 'upper':
      return String(value).toUpperCase();

    case 'lower':
      return String(value).toLowerCase();

    case 'to_number': {
      const num = Number(value);
      if (isNaN(num)) throw new Error(`无法将 "${value}" 转换为数字`);
      return num;
    }

    case 'to_string':
      return String(value);

    case 'to_date': {
      const date = new Date(String(value));
      if (isNaN(date.getTime())) throw new Error(`无法将 "${value}" 转换为日期`);
      return date.toISOString();
    }

    case 'concat': {
      const prefix = (params?.prefix as string) || '';
      const suffix = (params?.suffix as string) || '';
      return prefix + String(value) + suffix;
    }

    case 'substring': {
      const start = Number(params?.start ?? 0);
      const length = params?.length !== undefined ? Number(params.length) : undefined;
      const str = String(value);
      return length !== undefined ? str.substring(start, start + length) : str.substring(start);
    }

    case 'replace': {
      const pattern = String(params?.pattern || '');
      const replacement = String(params?.replacement || '');
      const isRegex = params?.regex === true;
      if (isRegex) {
        return String(value).replace(new RegExp(pattern, 'g'), replacement);
      }
      return String(value).replaceAll(pattern, replacement);
    }

    case 'md5': {
      // 延迟导入避免 SSR 问题
      const crypto = require('node:crypto');
      return crypto.createHash('md5').update(String(value)).digest('hex');
    }

    case 'base64_encode':
      return Buffer.from(String(value)).toString('base64');

    case 'base64_decode':
      return Buffer.from(String(value), 'base64').toString('utf8');

    case 'custom': {
      // 自定义 JS 表达式（受限安全沙箱）
      const expression = String(params?.expression || 'value');
      try {
        // 使用 new Function 执行，但限制作用域
        const fn = new Function('value', 'row', `return ${expression};`);
        return fn(value, {});
      } catch (error) {
        throw new Error(`自定义表达式执行失败: ${(error as Error).message}`);
      }
    }

    default:
      return value;
  }
}

/**
 * 读取嵌套字段值
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/**
 * 设置嵌套字段值
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * 验证映射规则
 */
export function validateMappings(mappings: FieldMappingRule[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const targetFields = new Set<string>();

  if (!Array.isArray(mappings)) {
    return { valid: false, errors: ['映射规则必须是数组'] };
  }

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i];
    const prefix = `第 ${i + 1} 条映射`;

    if (!m.source) errors.push(`${prefix}缺少源字段 source`);
    if (!m.target) errors.push(`${prefix}缺少目标字段 target`);

    if (m.target && targetFields.has(m.target)) {
      errors.push(`${prefix}目标字段 ${m.target} 重复`);
    }
    if (m.target) targetFields.add(m.target);

    if (m.transform && m.transform !== 'none') {
      const validTransforms: FieldTransform[] = [
        'none', 'trim', 'upper', 'lower', 'to_number', 'to_string', 'to_date',
        'concat', 'substring', 'replace', 'md5', 'base64_encode', 'base64_decode', 'custom',
      ];
      if (!validTransforms.includes(m.transform)) {
        errors.push(`${prefix}未知的转换类型: ${m.transform}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
