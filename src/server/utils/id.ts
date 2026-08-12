import { randomBytes, createHash } from 'node:crypto';

/**
 * 生成短 ID（基于时间戳 + 随机字符，类似 nanoid）
 */
export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(6).toString('base64url');
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * 生成 traceId，用于链路追踪
 */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * MD5 哈希
 */
export function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

/**
 * SHA256 哈希
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
