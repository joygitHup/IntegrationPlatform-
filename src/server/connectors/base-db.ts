import {
  ISourceConnector,
  ITargetConnector,
  StreamReadOptions,
  StreamWriteOptions,
  ColumnInfo,
  StandardDataType,
  SyncMode,
  Watermark,
  ConnectorMetadata,
  ConfigSchema,
} from './types';

/**
 * 关系型数据库连接器基类
 * 实现通用的读/写/分页逻辑，具体数据库驱动由子类提供
 */
export abstract class BaseRelationalDbConnector implements ISourceConnector, ITargetConnector {
  abstract readonly type: string;
  abstract readonly name: string;
  abstract readonly metadata: ConnectorMetadata;

  /** 子类实现：创建原生连接 */
  protected abstract createNativeConnection(config: Record<string, any>): Promise<any>;
  /** 子类实现：关闭原生连接 */
  protected abstract closeNativeConnection(conn: any): Promise<void>;
  /** 子类实现：执行查询 */
  protected abstract executeQuery(conn: any, sql: string, params?: any[]): Promise<{ rows: any[]; fields: ColumnInfo[] }>;
  /** 子类实现：执行批量插入 */
  protected abstract executeInsert(conn: any, table: string, records: Record<string, any>[]): Promise<number>;
  /** 子类实现：字段类型 → 标准类型 */
  protected abstract mapToStandardType(dbType: string): StandardDataType;

  async connect(config: Record<string, any>): Promise<any> {
    return this.createNativeConnection(config);
  }

  async disconnect(connection: any): Promise<void> {
    if (connection) {
      await this.closeNativeConnection(connection);
    }
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const startTime = Date.now();
    let conn: any;
    try {
      conn = await this.createNativeConnection(config);
      const latency = Date.now() - startTime;
      return { success: true, latencyMs: latency };
    } catch (error: any) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        message: error?.message || String(error),
      };
    } finally {
      if (conn) {
        try { await this.closeNativeConnection(conn); } catch {}
      }
    }
  }

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    const schema = this.metadata.configSchema;
    for (const field of schema.fields) {
      if (field.required && !config[field.name]) {
        errors.push(`${field.label}不能为空`);
      }
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    return [];
  }

  async describeTable(connection: any, tableName: string): Promise<ColumnInfo[]> {
    return [];
  }

  async *streamRead(
    connection: any,
    options: StreamReadOptions,
  ): AsyncGenerator<Record<string, any>[]> {
    const { tableName, columns, syncMode, watermark, batchSize = 1000 } = options;

    let offset = 0;
    let currentWatermark: Watermark | undefined = watermark;
    const cols = columns?.join(', ') || '*';

    while (true) {
      let sql = `SELECT ${cols} FROM ${tableName}`;
      const params: any[] = [];

      if (syncMode === SyncMode.INCREMENTAL && currentWatermark?.field) {
        const op = currentWatermark.strategy === 'id' ? '>' : '>=';
        sql += ` WHERE ${currentWatermark.field} ${op} ?`;
        params.push(currentWatermark.value);
        sql += ` ORDER BY ${currentWatermark.field} ASC`;
      }

      sql += ` LIMIT ${batchSize}`;
      if (syncMode === SyncMode.FULL) {
        sql += ` OFFSET ${offset}`;
      }

      const { rows } = await this.executeQuery(connection, sql, params);
      if (rows.length === 0) break;

      // 更新水位线
      if (syncMode === SyncMode.INCREMENTAL && currentWatermark?.field && rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        currentWatermark = {
          ...currentWatermark,
          value: lastRow[currentWatermark.field],
          updatedAt: new Date(),
        };
      }

      yield rows;

      if (syncMode === SyncMode.FULL) {
        offset += rows.length;
      }
      if (rows.length < batchSize) break;
    }
  }

  async getReadCount(connection: any, options: StreamReadOptions): Promise<number> {
    let sql = `SELECT COUNT(*) as cnt FROM ${options.tableName}`;
    const params: any[] = [];
    if (options.syncMode === SyncMode.INCREMENTAL && options.watermark?.field) {
      const op = options.watermark.strategy === 'id' ? '>' : '>=';
      sql += ` WHERE ${options.watermark.field} ${op} ?`;
      params.push(options.watermark.value);
    }
    const { rows } = await this.executeQuery(connection, sql, params);
    return Number(rows[0]?.cnt || 0);
  }

  async batchWrite(
    connection: any,
    options: StreamWriteOptions,
    records: Record<string, any>[],
  ): Promise<{ written: number }> {
    if (records.length === 0) return { written: 0 };
    const written = await this.executeInsert(connection, options.tableName, records);
    return { written };
  }

  normalizeType(dbType: string): StandardDataType {
    return this.mapToStandardType(dbType);
  }

  get configSchema(): ConfigSchema {
    return this.metadata.configSchema;
  }
}
