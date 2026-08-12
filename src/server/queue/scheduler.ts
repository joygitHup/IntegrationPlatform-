/**
 * 任务调度器 - 基于 cron 表达式的定时触发
 * 使用 setInterval 模拟 cron 调度（简单实现，生产环境用 bullmq repeatable jobs）
 */
import { listScheduledJobs } from '@/server/services/job-service';
import { getQueue } from './index';
import { createExecution } from './etl-executor';
import { generateTraceId } from '@/server/utils/id';

interface ScheduledJob {
  jobId: string;
  cron: string;
  nextRunAt: number;
}

class JobScheduler {
  private scheduled = new Map<string, ScheduledJob>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    console.log('[Scheduler] Started');

    // 每 30 秒检查一次
    this.timer = setInterval(() => this.tick(), 30000);

    // 启动时立即加载
    this.loadScheduledJobs();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped');
  }

  async loadScheduledJobs() {
    try {
      const jobs = await listScheduledJobs();
      const now = Date.now();

      // 移除已停用的任务
      for (const [jobId] of this.scheduled) {
        if (!jobs.find((j) => j.id === jobId)) {
          this.scheduled.delete(jobId);
        }
      }

      // 添加/更新任务
      for (const job of jobs) {
        if (job.scheduleCron) {
          const nextRun = this.calculateNextRun(job.scheduleCron, now);
          this.scheduled.set(job.id, {
            jobId: job.id,
            cron: job.scheduleCron,
            nextRunAt: nextRun,
          });
        }
      }

      console.log(`[Scheduler] Loaded ${this.scheduled.size} scheduled jobs`);
    } catch (error) {
      console.error('[Scheduler] Failed to load jobs:', (error as Error).message);
    }
  }

  private async tick() {
    const now = Date.now();

    for (const [jobId, sched] of this.scheduled) {
      if (now >= sched.nextRunAt) {
        // 触发任务
        this.triggerJob(jobId);
        // 计算下一次运行时间
        sched.nextRunAt = this.calculateNextRun(sched.cron, now);
      }
    }

    // 每分钟刷新任务列表（检测新增/删除）
    if (now % 60000 < 30000) {
      this.loadScheduledJobs();
    }
  }

  private async triggerJob(jobId: string) {
    try {
      const traceId = generateTraceId();
      const executionId = await createExecution({
        jobId,
        triggerType: 'schedule',
      });

      const queue = await getQueue();
      const queueJobId = await queue.add({
        jobId,
        executionId,
        triggerType: 'schedule',
      });

      console.log(`[Scheduler] Triggered job ${jobId}, execution=${executionId}, queueJob=${queueJobId}`);
    } catch (error) {
      console.error(`[Scheduler] Failed to trigger job ${jobId}:`, (error as Error).message);
    }
  }

  /**
   * 简单的 cron 计算（支持 5 位 cron：分 时 日 月 周）
   * 这是一个简化实现，生产环境建议使用 cron-parser 库
   */
  private calculateNextRun(cronExpr: string, fromTime: number): number {
    // 简化处理：根据 cron 表达式的语义估算下一次运行时间
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) return fromTime + 60000; // 默认 1 分钟后

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    const now = new Date(fromTime);
    const next = new Date(now);
    next.setSeconds(0, 0);

    // 每分钟
    if (minute === '*' && hour === '*') {
      next.setMinutes(next.getMinutes() + 1);
      return next.getTime();
    }

    // 每 N 分钟 (*\/N 格式)
    if (minute.startsWith('*/')) {
      const interval = parseInt(minute.slice(2), 10);
      if (interval > 0) {
        next.setMinutes(Math.floor(next.getMinutes() / interval) * interval + interval);
        return next.getTime();
      }
    }

    // 固定时间（指定分钟和小时）
    if (minute !== '*' && hour !== '*' && !minute.includes(',') && !hour.includes(',')) {
      const targetMin = parseInt(minute, 10);
      const targetHour = parseInt(hour, 10);
      next.setHours(targetHour, targetMin, 0, 0);
      if (next.getTime() <= fromTime) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime();
    }

    // 其他情况默认 5 分钟后
    next.setMinutes(next.getMinutes() + 5);
    return next.getTime();
  }

  getStatus() {
    return {
      running: this.running,
      scheduledCount: this.scheduled.size,
      jobs: Array.from(this.scheduled.entries()).map(([id, s]) => ({
        jobId: id,
        cron: s.cron,
        nextRunAt: new Date(s.nextRunAt).toISOString(),
      })),
    };
  }
}

export const jobScheduler = new JobScheduler();
