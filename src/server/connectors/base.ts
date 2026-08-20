/**
 * 连接器插件接口定义
 *
 * 所有连接器必须实现此接口，支持插件化注册和发现
 * 主要类型从 types.ts 导入，这里补充运行时接口
 */

import type {
  IConnector,
  ConnectorMetadata,
  ConfigFieldDef as ConfigField,
  ConfigSchema as ConnectorConfigSchema,
  AuthMethodDef as AuthMethod,
  ConnectorCategory,
  ConnectorType,
  StandardDataType,
  ColumnInfo as FieldMetadata,
  TableMetadata,
  SyncMode,
  Watermark,
  StreamReadOptions,
  StreamWriteOptions,
  ConnectorCapabilities,
} from './types';

// 重新导出核心类型
export type {
  IConnector,
  ConnectorMetadata,
  ConfigField,
  ConnectorConfigSchema,
  AuthMethod,
  ConnectorCategory,
  StandardDataType,
  FieldMetadata,
  TableMetadata,
  SyncMode,
  Watermark,
};

// 源/目标连接器别名（类型系统不区分，运行时用 typeSupport 判断）
export type ISourceConnector = IConnector;
export type ITargetConnector = IConnector;

/** 连接测试结果 */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  /** 连接耗时（毫秒） */
  latencyMs?: number;
  /** 服务端版本信息 */
  serverVersion?: string;
  /** 详细诊断信息 */
  details?: Record<string, unknown>;
}

/** 数据源配置验证结果 */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** 读取参数（分页/过滤） */
export interface ReadOptions {
  /** 表 / 集合 / Topic 名 */
  table: string;
  /** 字段列表（空 = 所有字段） */
  fields?: string[];
  /** 过滤条件（连接器自行解析） */
  filter?: Record<string, unknown>;
  /** 排序字段 */
  orderBy?: string;
  /** 排序方向 */
  orderDirection?: 'asc' | 'desc';
  /** 批次大小 */
  batchSize?: number;
  /** 增量同步水位线（每种连接器自行解释） */
  watermark?: Watermark;
  /** 最大读取条数（用于测试/调试） */
  limit?: number;
  /** 同步模式 */
  syncMode?: SyncMode;
}

/** 写入结果 */
export interface WriteResult {
  /** 成功写入行数 */
  successCount: number;
  /** 失败行数 */
  failedCount: number;
  /** 失败明细 */
  failures?: Array<{
    record: Record<string, unknown>;
    error: string;
    rowIndex?: number;
  }>;
  /** 写入后的水位线值（用于增量） */
  watermarkValue?: unknown;
}

/** 连接池统计 */
export interface PoolStats {
  /** 总连接数 */
  totalConnections: number;
  /** 活跃连接数 */
  activeConnections: number;
  /** 空闲连接数 */
  idleConnections: number;
  /** 等待获取连接的请求数 */
  waitingRequests: number;
  /** 最近一次健康检查时间 */
  lastHealthCheckAt?: Date;
  /** 最近一次健康检查是否通过 */
  lastHealthCheckOk?: boolean;
}
