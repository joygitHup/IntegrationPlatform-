import { validatePasswordStrength } from '@/lib/user-form';

export function validateLoginForm(username: string, password: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!username.trim()) errors.username = '请输入用户名';
  if (!password) errors.password = '请输入密码';
  return errors;
}

export function validateChangePasswordForm(form: {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
  username?: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.oldPassword) errors.oldPassword = '请输入原密码';
  if (!form.newPassword) errors.newPassword = '请输入新密码';
  else {
    const strength = validatePasswordStrength(form.newPassword, form.username);
    if (strength) errors.newPassword = strength;
  }
  if (form.newPassword && form.oldPassword && form.newPassword === form.oldPassword) {
    errors.newPassword = '新密码不能与原密码相同';
  }
  if (form.newPassword !== form.confirmPassword) errors.confirmPassword = '两次输入的密码不一致';
  return errors;
}
