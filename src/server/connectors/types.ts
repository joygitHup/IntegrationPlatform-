/**
 * 标准数据类型体系
 * 所有连接器都需要实现「源类型 ↔ 标准类型」的双向映射
 */

/** 标准数据类型枚举 */
export enum StandardDataType {
  STRING = 'string',
  INTEGER = 'integer',
  FLOAT = 'float',
  DECIMAL = 'decimal',
  BOOLEAN = 'boolean',
  DATE = 'date',
  DATETIME = 'datetime',
  TIMESTAMP = 'timestamp',
  JSON = 'json',
  BINARY = 'binary',
  ARRAY = 'array',
  UNKNOWN = 'unknown',
}

/** 类型转换安全级别 */
export enum TypeConversionSafety {
  SAFE = 'safe',
  WARN = 'warn',
  UNSAFE = 'unsafe',
}

/** 连接器类型 */
export type ConnectorType = 'source' | 'target' | 'both';

/** 连接器类别 */
export type ConnectorCategory = 'database' | 'messaging' | 'api' | 'file' | 'saas';

/** 同步模式 */
export enum SyncMode {
  FULL = 'full',
  INCREMENTAL = 'incremental',
}

/** 水位线策略 */
export enum WatermarkStrategy {
  /** 自增 ID */
  ID = 'id',
  /** 时间戳 / 时间字段 */
  TIMESTAMP = 'timestamp',
  /** 版本号 */
  VERSION = 'version',
  /** 混合模式（时间戳 + ID 防回退） */
  HYBRID = 'hybrid',
}

/** 水位线 */
export interface Watermark {
  field: string;
  strategy: WatermarkStrategy;
  value: any;
  updatedAt?: Date;
}

/** 列信息 */
export interface ColumnInfo {
  name: string;
  type: string;
  standardType: StandardDataType;
  nullable?: boolean;
  defaultValue?: string;
  comment?: string;
  primaryKey?: boolean;
}

/** 读取选项 */
export interface StreamReadOptions {
  tableName: string;
  columns?: string[];
  syncMode: SyncMode;
  watermark?: Watermark;
  batchSize?: number;
  filter?: Record<string, any>;
}

/** 写入选项 */
export interface StreamWriteOptions {
  tableName: string;
  columns?: string[];
  mode: 'insert' | 'upsert' | 'replace';
  primaryKey?: string[];
  batchSize?: number;
}

/** 连接器配置字段定义 */
export interface ConfigFieldDef {
  name: string;
  label: string;
  type: 'string' | 'password' | 'number' | 'boolean' | 'select' | 'textarea';
  required?: boolean;
  defaultValue?: any;
  placeholder?: string;
  description?: string;
  options?: { label: string; value: string }[];
  showWhen?: { field: string; value: any };
  sensitive?: boolean;
  /** 分组，用于前端表单分组展示 */
  group?: string;
  /** 帮助提示文案 */
  help?: string;
}

/** 配置 Schema */
export interface ConfigSchema {
  fields: ConfigFieldDef[];
  /** 必填字段列表 */
  required?: string[];
}

/** 认证方式枚举 */
export type AuthMethodType = 'password' | 'apikey' | 'oauth2' | 'token' | 'sasl' | 'iam' | 'anonymous' | 'publickey';

/** 认证方式定义（含展示信息） */
export interface AuthMethodDef {
  type: AuthMethodType;
  label: string;
  default?: boolean;
}

/** 表元数据 */
export interface TableMetadata {
  tableName: string;
  tableType: string;
  comment?: string;
}

/** 连接器能力 */
export interface ConnectorCapabilities {
  canRead: boolean;
  canWrite: boolean;
  supportsFilter?: boolean;
  supportsIncremental?: boolean;
  supportsUpsert?: boolean;
  supportsPooling?: boolean;
  supportsStreaming?: boolean;
  /** 是否支持自动发现表结构 */
  canDiscoverSchema?: boolean;
}

/** 连接器元数据 */
export interface ConnectorMetadata {
  /** 连接器类型标识（如 mysql、oracle、http_api） */
  type: string;
  /** 英文标识名（可选，旧连接器可用 displayName 替代） */
  name?: string;
  /** 前端展示名 */
  displayName?: string;
  /** 图标名（可选） */
  icon?: string;
  category: ConnectorCategory;
  description: string;
  /** 支持的方向（源/目标/双向，可选） */
  typeSupport?: ConnectorType;
  /** 能力描述（可选） */
  capabilities?: ConnectorCapabilities;
  /** 支持的认证方式（可选） */
  authMethods?: AuthMethodDef[];
  /** 版本号（可选） */
  version?: string;
  configSchema: ConfigSchema;
}

/** 连接器基础接口 */
export interface IConnector {
  readonly type: string;
  readonly name: string;
  readonly metadata: ConnectorMetadata;

  /** 测试连接 */
  testConnection?(config: Record<string, any>): Promise<{
    success: boolean;
    message?: string;
    latencyMs?: number;
    serverVersion?: string;
    details?: Record<string, unknown>;
  }>;
  /** 验证配置合法性 */
  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] };
}

/** 源连接器接口 */
export interface ISourceConnector extends IConnector {
  connect(config: Record<string, any>): Promise<any>;
  disconnect(connection: any): Promise<void>;
  listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]>;
  describeTable(connection: any, tableName: string): Promise<ColumnInfo[]>;
  streamRead(connection: any, options: StreamReadOptions): AsyncGenerator<Record<string, any>[]>;
  getReadCount(connection: any, options: StreamReadOptions): Promise<number>;
}

/** 目标连接器接口 */
export interface ITargetConnector extends IConnector {
  connect(config: Record<string, any>): Promise<any>;
  disconnect(connection: any): Promise<void>;
  batchWrite(connection: any, options: StreamWriteOptions, records: Record<string, any>[]): Promise<{ written: number }>;
  truncate?(connection: any, tableName: string): Promise<void>;
}
