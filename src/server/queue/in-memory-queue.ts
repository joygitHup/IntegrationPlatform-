/**
 * 内存队列实现 - 用于开发环境和无 Redis 场景
 * 基于 setTimeout 的简单队列，支持并发控制、延迟执行、状态追踪
 */
import type { JobQueue, JobData, JobResult, QueueJob } from './index';
import { generateId } from '@/server/utils/id';

interface InternalJob {
  id: string;
  data: JobData;
  status: QueueJob['status'];
  attemptsMade: number;
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: JobResult;
  timer?: NodeJS.Timeout;
}

export class InMemoryQueue implements JobQueue {
  private jobs = new Map<string, InternalJob>();
  private waitingQueue: string[] = [];
  private handler: ((job: JobData) => Promise<JobResult>) | null = null;
  private concurrency = 5;
  private activeCount = 0;

  async add(data: JobData, options?: { delay?: number; priority?: number }): Promise<string> {
    const id = generateId('q');
    const job: InternalJob = {
      id,
      data,
      status: 'waiting',
      attemptsMade: 0,
      addedAt: Date.now(),
    };

    this.jobs.set(id, job);

    if (options?.delay && options.delay > 0) {
      job.status = 'delayed';
      job.timer = setTimeout(() => {
        job.status = 'waiting';
        this.waitingQueue.push(id);
        this.processNext();
      }, options.delay);
    } else {
      // priority 越大越优先插入队列头部
      if (options?.priority && options.priority > 0) {
        this.waitingQueue.unshift(id);
      } else {
        this.waitingQueue.push(id);
      }
      // 下一帧再处理，保证 add 返回后再执行
      setImmediate(() => this.processNext());
    }

    return id;
  }

  process(handler: (job: JobData) => Promise<JobResult>): void {
    this.handler = handler;
    // 如果已经有等待中的任务，立即开始处理
    setImmediate(() => this.processNext());
  }

  private async processNext(): Promise<void> {
    if (!this.handler) return;
    if (this.activeCount >= this.concurrency) return;
    if (this.waitingQueue.length === 0) return;

    const jobId = this.waitingQueue.shift();
    if (!jobId) return;

    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'waiting') {
      this.processNext();
      return;
    }

    this.activeCount++;
    job.status = 'active';
    job.startedAt = Date.now();
    job.attemptsMade++;

    try {
      const result = await this.handler(job.data);
      job.result = result;
      job.status = result.success ? 'completed' : 'failed';
    } catch (error) {
      job.status = 'failed';
      job.result = {
        success: false,
        errorMessage: (error as Error).message,
      };
    } finally {
      job.finishedAt = Date.now();
      this.activeCount--;
      // 继续处理下一个
      setImmediate(() => this.processNext());
    }
  }

  async getJob(jobId: string): Promise<QueueJob | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return {
      id: job.id,
      data: job.data,
      status: job.status,
      attemptsMade: job.attemptsMade,
    };
  }

  async getStatus(): Promise<{ waiting: number; active: number; completed: number; failed: number }> {
    let waiting = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (const job of this.jobs.values()) {
      switch (job.status) {
        case 'waiting':
        case 'delayed':
          waiting++;
          break;
        case 'active':
          active++;
          break;
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
      }
    }

    return { waiting, active, completed, failed };
  }

  async close(): Promise<void> {
    // 清理所有定时器
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
      }
    }
    this.waitingQueue = [];
  }
}
