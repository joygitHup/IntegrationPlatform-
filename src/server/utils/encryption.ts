import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// 加密密钥，优先从环境变量读取，开发环境使用默认值
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || 'integration-platform-secret-key-2024';
  return scryptSync(secret, 'salt', 32);
}

/**
 * 加密字符串（AES-256-CBC）
 * 返回格式：iv:encrypted（base64）
 */
export function encrypt(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * 解密字符串
 */
export function decrypt(encryptedText: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      // 兼容明文（老数据）
      return encryptedText;
    }
    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = Buffer.from(parts[1], 'base64');
    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return encryptedText;
  }
}

/**
 * 脱敏敏感信息
 */
export function maskSensitive(value: string, keepStart = 3, keepEnd = 2): string {
  if (!value || value.length <= keepStart + keepEnd) {
    return '***';
  }
  const start = value.slice(0, keepStart);
  const end = value.slice(-keepEnd);
  const middle = '*'.repeat(Math.min(value.length - keepStart - keepEnd, 10));
  return `${start}${middle}${end}`;
}

/**
 * 判断是否为加密格式
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  const parts = value.split(':');
  return parts.length === 2 && parts[0].length >= 20;
}
