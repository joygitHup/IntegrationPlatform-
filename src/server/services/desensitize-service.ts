/**
 * 敏感字段脱敏工具
 * 支持三种模式：mask（掩码）、hash（哈希）、remove（移除）
 */
import { createHash } from 'crypto';

export type DesensitizeMode = 'mask' | 'hash' | 'remove';

/**
 * 对单条数据进行敏感字段脱敏
 * @param record 数据记录
 * @param sensitiveFields 敏感字段名列表
 * @param mode 脱敏方式
 */
export function desensitizeRecord(
  record: Record<string, unknown>,
  sensitiveFields: string[],
  mode: DesensitizeMode = 'mask',
): Record<string, unknown> {
  if (!sensitiveFields || sensitiveFields.length === 0) {
    return record;
  }

  const result = { ...record };

  for (const field of sensitiveFields) {
    if (result[field] === undefined || result[field] === null) {
      continue;
    }

    const value = String(result[field]);

    switch (mode) {
      case 'mask':
        result[field] = maskValue(value);
        break;
      case 'hash':
        result[field] = hashValue(value);
        break;
      case 'remove':
        delete result[field];
        break;
    }
  }

  return result;
}

/**
 * 对数据批次进行脱敏
 */
export function desensitizeBatch(
  records: Record<string, unknown>[],
  sensitiveFields: string[],
  mode: DesensitizeMode = 'mask',
): Record<string, unknown>[] {
  return records.map((r) => desensitizeRecord(r, sensitiveFields, mode));
}

/**
 * 掩码处理
 * - 手机号：保留前3后4
 * - 邮箱：@前保留首字符
 * - 身份证：保留前3后4
 * - 其他：保留首末字符，中间用 * 替换
 */
export function maskValue(value: string): string {
  if (!value) return value;

  const len = value.length;

  // 手机号（11位数字）
  if (/^\d{11}$/.test(value)) {
    return value.slice(0, 3) + '****' + value.slice(7);
  }

  // 邮箱
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    if (local.length <= 1) {
      return '*@' + domain;
    }
    return local[0] + '*'.repeat(Math.max(local.length - 2, 2)) + local[local.length - 1] + '@' + domain;
  }

  // 身份证（18位）
  if (/^\d{17}[\dXx]$/.test(value)) {
    return value.slice(0, 3) + '***********' + value.slice(14);
  }

  // 通用规则：首末各保留25%，中间掩码
  if (len <= 2) {
    return '*'.repeat(len);
  }
  if (len <= 4) {
    return value[0] + '**' + value[len - 1];
  }
  const keep = Math.floor(len * 0.25);
  const maskLen = len - keep * 2;
  return value.slice(0, keep) + '*'.repeat(maskLen) + value.slice(len - keep);
}

/**
 * SHA-256 哈希处理
 */
export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16) + '...';
}

/**
 * 计算数据的指纹哈希（用于去重和追溯）
 */
export function computeDataFingerprint(data: Record<string, unknown>): string {
  const sorted = JSON.stringify(Object.keys(data).sort().reduce((acc, k) => {
    acc[k] = data[k];
    return acc;
  }, {} as Record<string, unknown>));
  return createHash('sha256').update(sorted).digest('hex');
}

/**
 * 判断字段是否为敏感字段（基于常见敏感字段名模糊匹配）
 */
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /mobile|phone|tel/i,
  /id[_-]?card|idcard|identity/i,
  /email/i,
  /address/i,
  /salary|income/i,
  /bank[_-]?card|card[_-]?no/i,
];

export function isLikelySensitive(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

/**
 * 自动检测数据中的敏感字段
 */
export function detectSensitiveFields(
  record: Record<string, unknown>,
  threshold: number = 1,
): string[] {
  const fields: string[] = [];
  let score = 0;

  for (const field of Object.keys(record)) {
    if (isLikelySensitive(field)) {
      score++;
      fields.push(field);
    }
  }

  return score >= threshold ? fields : [];
}
