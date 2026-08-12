import { RateLimiterMemory } from 'rate-limiter-flexible';

// 登录限流: 每 IP 每分钟 10 次
const loginLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
});

// API 通用限流: 每 IP 每分钟 600 次
const apiLimiter = new RateLimiterMemory({
  points: 600,
  duration: 60,
});

// 敏感操作限流: 每用户每分钟 30 次
const sensitiveActionLimiter = new RateLimiterMemory({
  points: 30,
  duration: 60,
});

export interface RateLimitResult {
  success: boolean;
  remainingPoints: number;
  msBeforeNext: number;
}

export async function checkLoginRateLimit(ip: string): Promise<RateLimitResult> {
  try {
    const result = await loginLimiter.consume(`login:${ip}`);
    return {
      success: true,
      remainingPoints: result.remainingPoints,
      msBeforeNext: result.msBeforeNext,
    };
  } catch (error: any) {
    return {
      success: false,
      remainingPoints: error.remainingPoints || 0,
      msBeforeNext: error.msBeforeNext || 0,
    };
  }
}

export async function checkApiRateLimit(ip: string): Promise<RateLimitResult> {
  try {
    const result = await apiLimiter.consume(`api:${ip}`);
    return {
      success: true,
      remainingPoints: result.remainingPoints,
      msBeforeNext: result.msBeforeNext,
    };
  } catch (error: any) {
    return {
      success: false,
      remainingPoints: error.remainingPoints || 0,
      msBeforeNext: error.msBeforeNext || 0,
    };
  }
}

export async function checkSensitiveActionRateLimit(userId: string): Promise<RateLimitResult> {
  try {
    const result = await sensitiveActionLimiter.consume(`sensitive:${userId}`);
    return {
      success: true,
      remainingPoints: result.remainingPoints,
      msBeforeNext: result.msBeforeNext,
    };
  } catch (error: any) {
    return {
      success: false,
      remainingPoints: error.remainingPoints || 0,
      msBeforeNext: error.msBeforeNext || 0,
    };
  }
}
