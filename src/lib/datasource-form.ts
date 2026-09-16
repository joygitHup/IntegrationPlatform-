import type { ConnectorMetadata } from '@/lib/api-client';
import type { ConfigField, ConfigSchema } from '@/components/dynamic-config-form';

/** 与后端编码规则一致：字母开头，仅字母数字下划线中划线 */
export const DATASOURCE_CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function defaultsFromSchema(schema?: ConfigSchema | null): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of schema?.fields || []) {
    if (field.defaultValue !== undefined) {
      config[field.name] = field.defaultValue;
    }
  }
  return config;
}

export function fieldVisible(field: ConfigField, values: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  return String(values[field.showWhen.field] ?? '') === String(field.showWhen.value);
}

/** 校验连接配置必填项，返回字段错误（key 与 schema.fields.name 对齐） */
export function validateConfigFields(
  schema: ConfigSchema | undefined,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!schema?.fields) return errors;
  for (const field of schema.fields) {
    if (!field.required || !fieldVisible(field, values)) continue;
    const value = values[field.name];
    if (value === undefined || value === null || value === '') {
      errors[field.name] = `${field.label}不能为空`;
    }
  }
  return errors;
}

export function suggestCode(name: string, type: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (DATASOURCE_CODE_PATTERN.test(ascii)) {
    return ascii.slice(0, 64);
  }
  const suffix = Date.now().toString(36);
  return `${type || 'ds'}_${suffix}`.slice(0, 64);
}

export function resolveConnectorList(payload: unknown): ConnectorMetadata[] {
  if (Array.isArray(payload)) return payload as ConnectorMetadata[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).items)) {
    return (payload as any).items;
  }
  return [];
}
