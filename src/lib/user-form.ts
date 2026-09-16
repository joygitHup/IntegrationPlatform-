export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export const USER_STATUS_MAP: Record<string, { label: string; variant: string }> = {
  active: { label: '启用', variant: 'success' },
  disabled: { label: '禁用', variant: 'destructive' },
  locked: { label: '锁定', variant: 'warning' },
};

export const ROLE_LABELS: Record<string, string> = {
  admin: '超级管理员',
  developer: '开发者',
  operator: '运维',
  viewer: '只读用户',
};

export function roleLabel(code?: string, name?: string): string {
  return ROLE_LABELS[code || ''] || name || code || '-';
}

export interface UserForm {
  username: string;
  displayName: string;
  email: string;
  password: string;
  confirmPassword: string;
  roleId: string;
  status: string;
  /** 所属客户 client_id；空串=平台账号。客户账号建人时后端强制回本客户，忽略此入参 */
  clientId: string;
}

export const emptyUserForm: UserForm = {
  username: '',
  displayName: '',
  email: '',
  password: '',
  confirmPassword: '',
  roleId: '',
  status: 'active',
  clientId: '',
};

export function formFromUser(user: any): UserForm {
  return {
    username: user?.username || '',
    displayName: user?.displayName || '',
    email: user?.email || '',
    password: '',
    confirmPassword: '',
    roleId: user?.roleId || '',
    status: user?.status || 'active',
    clientId: user?.clientId || '',
  };
}

export const PASSWORD_HINT = '至少 8 位，须同时包含字母和数字，且不能与用户名相同';

const WEAK_PASSWORDS = new Set([
  '12345678',
  '123456789',
  'password',
  'password1',
  'qwerty12',
  'abc12345',
  '11111111',
  '00000000',
  'admin8888',
  'admin888',
]);

export function validatePasswordStrength(password: string, username = ''): string {
  if (!password || password.length < 8) return '密码至少 8 位，须同时包含字母和数字';
  if (password.length > 128) return '密码过长';
  if (username && password.toLowerCase() === username.toLowerCase()) return '密码不能与用户名相同';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码须同时包含字母和数字';
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return '密码过于简单，请更换';
  return '';
}

export function validateUserForm(form: UserForm, editing: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.username.trim()) errors.username = '请输入用户名';
  else if (form.username.trim().length < 3) errors.username = '用户名至少 3 个字符';
  else if (!USERNAME_PATTERN.test(form.username.trim())) {
    errors.username = '用户名须以字母开头，可包含字母、数字、下划线、点号和中划线';
  }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = '邮箱格式不正确';
  }
  if (!form.roleId) errors.roleId = '请选择角色';
  if (!editing) {
    if (!form.password) errors.password = '请输入密码';
    else {
      const strength = validatePasswordStrength(form.password, form.username);
      if (strength) errors.password = strength;
    }
    if (form.password !== form.confirmPassword) errors.confirmPassword = '两次输入的密码不一致';
  } else if (form.password) {
    const strength = validatePasswordStrength(form.password, form.username);
    if (strength) errors.password = strength;
    if (form.password !== form.confirmPassword) errors.confirmPassword = '两次输入的密码不一致';
  }
  return errors;
}

export function buildUserPayload(form: UserForm, editing: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    displayName: form.displayName.trim() || form.username.trim(),
    email: form.email.trim(),
    roleId: form.roleId,
    status: form.status || 'active',
  };
  if (!editing) {
    payload.username = form.username.trim();
    payload.password = form.password;
    // 仅创建时可指派客户；后端对客户账号会强制改派为其自身 client_id
    payload.clientId = form.clientId || '';
  } else if (form.password) {
    payload.password = form.password;
  }
  return payload;
}

export function resolveRoleList(payload: unknown): any[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).items)) {
    return (payload as any).items;
  }
  return [];
}
