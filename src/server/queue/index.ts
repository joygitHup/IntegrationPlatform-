/**
 * 队列抽象层 - 支持多种后端实现
 * 生产环境用 BullMQ（Redis），开发/测试环境用内存队列
 */

export interface JobData {
  jobId: string;
  executionId: string;
  triggeredBy?: string;
  triggerType: 'manual' | 'schedule' | 'webhook' | 'retry';
  options?: {
    retryCount?: number;
    batchSize?: number;
  };
}

export interface JobResult {
  success: boolean;
  totalRows?: number;
  successRows?: number;
  failedRows?: number;
  errorMessage?: string;
}

export interface QueueJob {
  id: string;
  data: JobData;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  attemptsMade: number;
}

export interface JobQueue {
  add(data: JobData, options?: { delay?: number; priority?: number }): Promise<string>;
  process(handler: (job: JobData) => Promise<JobResult>): void;
  getJob(jobId: string): Promise<QueueJob | null>;
  getStatus(): Promise<{ waiting: number; active: number; completed: number; failed: number }>;
  close(): Promise<void>;
}

// 单例
let queueInstance: JobQueue | null = null;

export async function getQueue(): Promise<JobQueue> {
  if (queueInstance) return queueInstance;

  // 优先尝试 Redis (BullMQ)
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;
  if (redisUrl) {
    try {
      // 动态加载 BullMQ 实现（可选）
      // 如果需要 Redis 支持，安装 bullmq 和 ioredis 并创建 bullmq-queue.ts
      console.warn('[Queue] Redis URL detected but BullMQ adapter not configured, using in-memory queue');
    } catch (error) {
      console.warn('[Queue] Redis unavailable, falling back to in-memory queue:', (error as Error).message);
    }
  }

  // 降级到内存队列
  const { InMemoryQueue } = await import('./in-memory-queue');
  queueInstance = new InMemoryQueue() as JobQueue;
  console.log('[Queue] Using in-memory backend');
  return queueInstance;
}

/**
 * 重置队列（测试用）
 */
export function resetQueue() {
  queueInstance = null;
}
