import { sign, verify, type SignOptions } from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'integration-platform-jwt-secret-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const JWT_REFRESH_EXPIRES_IN = '7d';

export interface JwtPayload {
  userId: string;
  username: string;
  roleId: string;
  type: 'access' | 'refresh';
}

/**
 * 生成 access token
 */
export function signAccessToken(payload: Omit<JwtPayload, 'type'>): string {
  const tokenPayload: JwtPayload = { ...payload, type: 'access' };
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'] };
  return sign(tokenPayload, JWT_SECRET, options);
}

/**
 * 生成 refresh token
 */
export function signRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
  const tokenPayload: JwtPayload = { ...payload, type: 'refresh' };
  const options: SignOptions = { expiresIn: JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'] };
  return sign(tokenPayload, JWT_SECRET, options);
}

/**
 * 验证 token
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}
