/**
 * Worker 初始化
 * 在服务启动时初始化队列处理器和调度器
 */
import { getQueue } from './index';
import { executeJob } from './etl-executor';
import { jobScheduler } from './scheduler';
import { seedDefaultData } from '@/server/services/user-service';

let initialized = false;

/**
 * 启动 worker（处理队列任务和调度）
 */
export async function startWorker() {
  if (initialized) return;
  initialized = true;

  console.log('[Worker] Starting worker...');

  try {
    // 初始化种子数据
    await seedDefaultData();

    // 初始化队列
    const queue = await getQueue();

    // 注册处理器
    queue.process(async (data) => {
      console.log(`[Worker] Processing job ${data.jobId} (execution: ${data.executionId})`);
      return executeJob(data);
    });

    // 启动调度器
    jobScheduler.start();

    console.log('[Worker] Worker started successfully');
  } catch (error) {
    console.error('[Worker] Failed to start worker:', (error as Error).message);
    initialized = false;
  }
}

/**
 * 停止 worker
 */
export async function stopWorker() {
  if (!initialized) return;

  console.log('[Worker] Stopping worker...');
  jobScheduler.stop();
  const queue = await getQueue();
  await queue.close();
  initialized = false;
  console.log('[Worker] Worker stopped');
}

// 导出调度器状态查询
export function getSchedulerStatus() {
  return jobScheduler.getStatus();
}
