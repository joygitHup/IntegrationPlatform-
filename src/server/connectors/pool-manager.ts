/**
 * 连接池管理器
 *
 * 功能：
 * 1. 连接复用：避免每次执行都新建连接
 * 2. 连接池参数：最大连接数、最小空闲、连接超时、获取超时
 * 3. 健康检测：定时探活，失效连接自动清理
 * 4. 连接状态监控：活跃连接数、等待数、创建数、失败数
 * 5. 限流保护：防止连接打爆源系统
 */

import { generateId } from '../utils/id';

export interface PoolConfig {
  maxSize: number;           // 最大连接数
  minIdle: number;           // 最小空闲连接数
  maxLifetimeMs: number;     // 连接最大存活时间
  idleTimeoutMs: number;     // 空闲超时回收时间
  acquireTimeoutMs: number;  // 获取连接超时时间
  healthCheckIntervalMs: number; // 健康检测间隔
}

export interface PooledConnection<T> {
  id: string;
  connection: T;
  createdAt: number;
  lastUsedAt: number;
  lastCheckedAt: number;
  isActive: boolean;
  useCount: number;
}

export interface PoolStats {
  totalCreated: number;
  totalDestroyed: number;
  totalFailed: number;
  activeCount: number;
  idleCount: number;
  waitingCount: number;
  maxReachedCount: number;
}

const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxSize: 10,
  minIdle: 2,
  maxLifetimeMs: 1800_000, // 30 分钟
  idleTimeoutMs: 600_000,   // 10 分钟
  acquireTimeoutMs: 10_000, // 10 秒
  healthCheckIntervalMs: 60_000, // 1 分钟
};

/**
 * 通用连接池：支持数据库、消息队列、HTTP Client 等任意连接类型
 * T = 连接对象类型（如 Pool / Connection / Channel 等）
 */
export class ConnectionPool<T> {
  private config: PoolConfig;
  private idleConnections: PooledConnection<T>[] = [];
  private activeConnections: Map<string, PooledConnection<T>> = new Map();
  private waitingQueue: Array<{ resolve: (conn: PooledConnection<T>) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }> = [];
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private stats: PoolStats = {
    totalCreated: 0,
    totalDestroyed: 0,
    totalFailed: 0,
    activeCount: 0,
    idleCount: 0,
    waitingCount: 0,
    maxReachedCount: 0,
  };
  private createConnectionFn: () => Promise<T>;
  private validateConnectionFn: (conn: T) => Promise<boolean>;
  private destroyConnectionFn: (conn: T) => Promise<void>;
  private isDestroyed = false;

  constructor(
    options: Partial<PoolConfig> & {
      create: () => Promise<T>;
      validate: (conn: T) => Promise<boolean>;
      destroy: (conn: T) => Promise<void>;
    },
  ) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...options };
    this.createConnectionFn = options.create;
    this.validateConnectionFn = options.validate;
    this.destroyConnectionFn = options.destroy;
    this.startHealthCheck();
  }

  /** 获取连接 */
  async acquire(): Promise<T> {
    if (this.isDestroyed) throw new Error('连接池已销毁');

    // 1. 优先从空闲池拿
    while (this.idleConnections.length > 0) {
      const pooled = this.idleConnections.shift()!;
      if (this.isConnectionValid(pooled)) {
        // 快速健康检查
        const isValid = await this.validateConnectionFn(pooled.connection).catch(() => false);
        if (isValid) {
          pooled.isActive = true;
          pooled.lastUsedAt = Date.now();
          pooled.useCount++;
          this.activeConnections.set(pooled.id, pooled);
          this.updateStats();
          return pooled.connection;
        }
        // 失效则销毁
        await this.destroyPooled(pooled);
      }
    }

    // 2. 没达到上限则新建
    if (this.activeConnections.size < this.config.maxSize) {
      try {
        const conn = await this.createConnectionFn();
        const pooled: PooledConnection<T> = {
          id: generateId('pool'),
          connection: conn,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          lastCheckedAt: Date.now(),
          isActive: true,
          useCount: 1,
        };
        this.activeConnections.set(pooled.id, pooled);
        this.stats.totalCreated++;
        if (this.activeConnections.size >= this.config.maxSize) {
          this.stats.maxReachedCount++;
        }
        this.updateStats();
        return conn;
      } catch (error) {
        this.stats.totalFailed++;
        throw error;
      }
    }

    // 3. 达到上限，进入等待队列
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waitingQueue.findIndex(q => q.timeout === timeout);
        if (idx >= 0) this.waitingQueue.splice(idx, 1);
        this.updateStats();
        reject(new Error(`获取连接超时（等待 ${this.config.acquireTimeoutMs}ms）`));
      }, this.config.acquireTimeoutMs);

      this.waitingQueue.push({
        resolve: (pooled) => {
          clearTimeout(timeout);
          resolve(pooled.connection);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
        timeout,
      });
      this.updateStats();
    });
  }

  /** 归还连接 */
  async release(conn: T): Promise<void> {
    const pooled = [...this.activeConnections.values()].find(p => p.connection === conn);
    if (!pooled) {
      // 未知连接，直接销毁
      await this.destroyConnectionFn(conn).catch(() => {});
      return;
    }

    this.activeConnections.delete(pooled.id);
    pooled.isActive = false;
    pooled.lastUsedAt = Date.now();

    // 检查连接是否还能用
    const stillValid = this.isConnectionValid(pooled);
    if (stillValid && this.idleConnections.length < this.config.maxSize) {
      this.idleConnections.push(pooled);
    } else {
      await this.destroyPooled(pooled);
    }

    // 唤醒一个等待者
    if (this.waitingQueue.length > 0 && this.idleConnections.length > 0) {
      const waiter = this.waitingQueue.shift()!;
      const pooledConn = this.idleConnections.shift()!;
      pooledConn.isActive = true;
      pooledConn.lastUsedAt = Date.now();
      pooledConn.useCount++;
      this.activeConnections.set(pooledConn.id, pooledConn);
      waiter.resolve(pooledConn);
    }

    this.updateStats();
  }

  /** 获取池统计 */
  getStats(): PoolStats {
    return { ...this.stats };
  }

  /** 销毁连接池 */
  async destroy(): Promise<void> {
    this.isDestroyed = true;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // 拒绝所有等待者
    for (const waiter of this.waitingQueue) {
      waiter.reject(new Error('连接池已关闭'));
    }
    this.waitingQueue = [];

    // 销毁所有连接
    const allConnections = [
      ...this.idleConnections,
      ...this.activeConnections.values(),
    ];
    for (const pooled of allConnections) {
      await this.destroyPooled(pooled);
    }
    this.idleConnections = [];
    this.activeConnections.clear();
  }

  // ========== 内部方法 ==========

  private isConnectionValid(pooled: PooledConnection<T>): boolean {
    const now = Date.now();
    // 超过最大存活时间
    if (now - pooled.createdAt > this.config.maxLifetimeMs) return false;
    return true;
  }

  private async destroyPooled(pooled: PooledConnection<T>): Promise<void> {
    try {
      await this.destroyConnectionFn(pooled.connection);
    } catch {
      // 忽略销毁错误
    }
    this.stats.totalDestroyed++;
    this.updateStats();
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      // 清理超时空闲连接
      const now = Date.now();
      const toRemove: number[] = [];
      for (let i = 0; i < this.idleConnections.length; i++) {
        const pooled = this.idleConnections[i];
        const idleTime = now - pooled.lastUsedAt;
        // 超过空闲超时且保持最小空闲数之上
        if (idleTime > this.config.idleTimeoutMs && this.idleConnections.length > this.config.minIdle) {
          toRemove.push(i);
          continue;
        }
        // 周期性健康检测
        if (now - pooled.lastCheckedAt > this.config.healthCheckIntervalMs) {
          pooled.lastCheckedAt = now;
          const isValid = await this.validateConnectionFn(pooled.connection).catch(() => false);
          if (!isValid) {
            toRemove.push(i);
          }
        }
      }
      // 倒序删除
      for (let i = toRemove.length - 1; i >= 0; i--) {
        const idx = toRemove[i];
        const pooled = this.idleConnections[idx];
        this.idleConnections.splice(idx, 1);
        await this.destroyPooled(pooled);
      }
      this.updateStats();
    }, this.config.healthCheckIntervalMs);
  }

  private updateStats(): void {
    this.stats.activeCount = this.activeConnections.size;
    this.stats.idleCount = this.idleConnections.length;
    this.stats.waitingCount = this.waitingQueue.length;
  }
}

/**
 * 连接池注册表：全局管理所有数据源的连接池
 * 键：datasourceId
 */
class PoolRegistry {
  private pools = new Map<string, ConnectionPool<unknown>>();

  get<T>(datasourceId: string): ConnectionPool<T> | undefined {
    return this.pools.get(datasourceId) as ConnectionPool<T> | undefined;
  }

  set<T>(datasourceId: string, pool: ConnectionPool<T>): void {
    this.pools.set(datasourceId, pool as ConnectionPool<unknown>);
  }

  remove(datasourceId: string): void {
    const pool = this.pools.get(datasourceId);
    if (pool) {
      pool.destroy().catch(() => {});
      this.pools.delete(datasourceId);
    }
  }

  getAllStats(): Record<string, PoolStats> {
    const result: Record<string, PoolStats> = {};
    for (const [id, pool] of this.pools) {
      result[id] = pool.getStats();
    }
    return result;
  }

  async clear(): Promise<void> {
    for (const pool of this.pools.values()) {
      await pool.destroy();
    }
    this.pools.clear();
  }
}

export const poolRegistry = new PoolRegistry();
