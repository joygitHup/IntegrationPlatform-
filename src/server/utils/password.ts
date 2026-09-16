import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

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

export function validatePassword(plain: string, username = ''): void {
  if (!plain || plain.length < 8) {
    throw new Error('密码至少 8 位，须同时包含字母和数字');
  }
  if (plain.length > 128) {
    throw new Error('密码过长');
  }
  if (username && plain.toLowerCase() === username.toLowerCase()) {
    throw new Error('密码不能与用户名相同');
  }
  if (!/[A-Za-z]/.test(plain) || !/\d/.test(plain)) {
    throw new Error('密码须同时包含字母和数字');
  }
  if (WEAK_PASSWORDS.has(plain.toLowerCase())) {
    throw new Error('密码过于简单，请更换');
  }
}

/**
 * 密码哈希
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * 密码验证
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
