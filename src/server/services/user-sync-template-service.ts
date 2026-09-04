/**
 * 用户同步专用模板服务
 * 提供预置的字段映射模板、状态码转换规则、常见系统的适配配置
 */
import type { FieldMappingRule, FieldTransform } from '@/server/db/schema/integration-job';

// ============================================================
// 通用用户字段标准映射
// ============================================================
export interface UserSyncTemplate {
  id: string;
  name: string;
  description: string;
  category: string; // hr / im / email / crm / generic
  // 预设的源字段 → 目标字段映射
  fieldMappings: FieldMappingRule[];
  // 推荐的匹配键
  defaultMatchKeys: string[];
  // 推荐的敏感字段
  defaultSensitiveFields: string[];
  // 状态字段映射（不同系统状态码的转换规则）
  statusMapping: {
    sourceField: string;
    targetField: string;
    rules: Array<{ from: string | number | boolean; to: string | number | boolean; label: string }>;
  };
}

// ============================================================
// 预置模板库
// ============================================================
const TEMPLATES: UserSyncTemplate[] = [
  {
    id: 'generic_user',
    name: '通用用户同步',
    description: '适用于大多数用户表到用户表的同步场景',
    category: 'generic',
    defaultMatchKeys: ['username', 'employee_id'],
    defaultSensitiveFields: ['password', 'mobile', 'email', 'id_card', 'idCard'],
    fieldMappings: [
      { source: 'username', target: 'username', transform: 'none', required: true },
      { source: 'real_name', target: 'name', transform: 'none' },
      { source: 'email', target: 'email', transform: 'none' },
      { source: 'mobile', target: 'phone', transform: 'none' },
      { source: 'employee_id', target: 'employee_no', transform: 'none' },
      { source: 'department_id', target: 'dept_code', transform: 'none' },
      { source: 'position', target: 'position', transform: 'none' },
      { source: 'status', target: 'is_active', transform: 'custom', params: { expression: 'value === 1 || value === "active"' } },
    ],
    statusMapping: {
      sourceField: 'status',
      targetField: 'is_active',
      rules: [
        { from: 1, to: true, label: '在职' },
        { from: 0, to: false, label: '离职' },
        { from: 'active', to: true, label: '启用' },
        { from: 'inactive', to: false, label: '禁用' },
      ],
    },
  },
  {
    id: 'hr_to_oa',
    name: 'HR 系统 → OA 系统',
    description: '从 HR 系统同步员工信息到 OA 办公系统',
    category: 'hr',
    defaultMatchKeys: ['employee_id'],
    defaultSensitiveFields: ['id_card', 'mobile', 'emergency_contact', 'bank_card'],
    fieldMappings: [
      { source: 'employee_id', target: 'staff_no', transform: 'none', required: true },
      { source: 'name', target: 'real_name', transform: 'none', required: true },
      { source: 'pinyin_name', target: 'username', transform: 'none' },
      { source: 'email', target: 'email', transform: 'none' },
      { source: 'mobile', target: 'mobile', transform: 'none' },
      { source: 'department_code', target: 'dept_id', transform: 'none' },
      { source: 'position_name', target: 'position', transform: 'none' },
      { source: 'entry_date', target: 'entry_time', transform: 'to_date' },
      { source: 'status', target: 'status', transform: 'none' },
      { source: 'gender', target: 'gender', transform: 'none' },
    ],
    statusMapping: {
      sourceField: 'employee_status',
      targetField: 'user_status',
      rules: [
        { from: 'on_job', to: 'active', label: '在职' },
        { from: 'probation', to: 'active', label: '试用期' },
        { from: 'resigned', to: 'disabled', label: '已离职' },
        { from: 'retired', to: 'disabled', label: '已退休' },
      ],
    },
  },
  {
    id: 'hr_to_email',
    name: 'HR 系统 → 企业邮箱',
    description: '从 HR 系统同步入职员工到企业邮箱系统',
    category: 'email',
    defaultMatchKeys: ['employee_id', 'email'],
    defaultSensitiveFields: ['password', 'mobile', 'id_card'],
    fieldMappings: [
      { source: 'pinyin_name', target: 'account', transform: 'lower', required: true },
      { source: 'name', target: 'display_name', transform: 'none' },
      { source: 'email', target: 'email', transform: 'none' },
      { source: 'department_name', target: 'department', transform: 'none' },
      { source: 'employee_id', target: 'employee_id', transform: 'none' },
      { source: 'mobile', target: 'mobile', transform: 'none' },
      { source: 'gender', target: 'gender', transform: 'none' },
      { source: 'status', target: 'status', transform: 'none' },
    ],
    statusMapping: {
      sourceField: 'status',
      targetField: 'account_status',
      rules: [
        { from: 'on_job', to: 'enabled', label: '启用' },
        { from: 'resigned', to: 'disabled', label: '禁用' },
      ],
    },
  },
  {
    id: 'ad_to_app',
    name: 'AD 域 → 业务系统',
    description: '从 Active Directory 同步用户到业务系统',
    category: 'generic',
    defaultMatchKeys: ['sAMAccountName', 'userPrincipalName'],
    defaultSensitiveFields: ['unicodePwd', 'userPassword', 'telephoneNumber'],
    fieldMappings: [
      { source: 'sAMAccountName', target: 'username', transform: 'none', required: true },
      { source: 'displayName', target: 'name', transform: 'none' },
      { source: 'givenName', target: 'first_name', transform: 'none' },
      { source: 'sn', target: 'last_name', transform: 'none' },
      { source: 'mail', target: 'email', transform: 'none' },
      { source: 'telephoneNumber', target: 'phone', transform: 'none' },
      { source: 'department', target: 'department', transform: 'none' },
      { source: 'title', target: 'title', transform: 'none' },
      { source: 'userPrincipalName', target: 'upn', transform: 'none' },
    ],
    statusMapping: {
      sourceField: 'userAccountControl',
      targetField: 'is_active',
      rules: [
        { from: 512, to: true, label: '正常账号' },
        { from: 514, to: false, label: '已禁用' },
        { from: 66048, to: true, label: '密码永不过期' },
        { from: 66050, to: false, label: '禁用+密码永不过期' },
      ],
    },
  },
];

// ============================================================
// 获取所有模板
// ============================================================
export function listUserSyncTemplates(category?: string): UserSyncTemplate[] {
  if (!category) return TEMPLATES;
  return TEMPLATES.filter((t) => t.category === category);
}

// ============================================================
// 根据 ID 获取模板
// ============================================================
export function getUserSyncTemplate(templateId: string): UserSyncTemplate | null {
  return TEMPLATES.find((t) => t.id === templateId) || null;
}

// ============================================================
// 应用模板到任务配置
// ============================================================
export function applyUserSyncTemplate(
  templateId: string,
  customOverrides?: {
    fieldMappings?: FieldMappingRule[];
    matchKeys?: string[];
    sensitiveFields?: string[];
  },
): {
  template: UserSyncTemplate | null;
  fieldMappings: FieldMappingRule[];
  matchKeys: string[];
  sensitiveFields: string[];
} {
  const template = getUserSyncTemplate(templateId);

  if (!template) {
    return {
      template: null,
      fieldMappings: customOverrides?.fieldMappings || [],
      matchKeys: customOverrides?.matchKeys || ['id'],
      sensitiveFields: customOverrides?.sensitiveFields || [],
    };
  }

  // 合并自定义覆盖
  const fieldMappings = customOverrides?.fieldMappings?.length
    ? mergeFieldMappings(template.fieldMappings, customOverrides.fieldMappings)
    : template.fieldMappings;

  const matchKeys = customOverrides?.matchKeys?.length
    ? customOverrides.matchKeys
    : template.defaultMatchKeys;

  const sensitiveFields = customOverrides?.sensitiveFields?.length
    ? customOverrides.sensitiveFields
    : template.defaultSensitiveFields;

  return { template, fieldMappings, matchKeys, sensitiveFields };
}

// ============================================================
// 合并字段映射（自定义映射覆盖模板映射）
// ============================================================
function mergeFieldMappings(
  base: FieldMappingRule[],
  overrides: FieldMappingRule[],
): FieldMappingRule[] {
  const map = new Map(base.map((m) => [m.source, m]));

  for (const override of overrides) {
    if (override.transform === 'none' && map.has(override.source)) {
      // 保留模板的 transform 配置
      map.set(override.source, { ...map.get(override.source)!, ...override });
    } else {
      map.set(override.source, override);
    }
  }

  return Array.from(map.values());
}

// ============================================================
// 状态码转换工具
// ============================================================
export function convertStatus(
  value: unknown,
  rules: Array<{ from: unknown; to: unknown }>,
  defaultValue: unknown = null,
): unknown {
  const rule = rules.find((r) => String(r.from) === String(value));
  return rule ? rule.to : defaultValue;
}

// ============================================================
// 自动生成初始密码
// ============================================================
export function generateInitialPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// ============================================================
// 从姓名生成拼音用户名（简化版，实际需要 pinyin 库）
// ============================================================
export function generateUsernameFromName(
  name: string,
  existingUsernames: Set<string>,
): string {
  // 简化：如果是英文/拼音，直接用；如果是中文，取首字母
  // 实际项目中应接入 pinyin-pro 之类的库
  let username = name.toLowerCase().replace(/\s+/g, '.');

  // 去重
  if (existingUsernames.has(username)) {
    let counter = 1;
    while (existingUsernames.has(`${username}${counter}`)) {
      counter++;
    }
    username = `${username}${counter}`;
  }

  return username;
}
