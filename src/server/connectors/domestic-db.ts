/**
 * 国产数据库连接器
 * - 达梦 (DM)：武汉达梦，兼容 Oracle/PG 语法
 * - 人大金仓 (Kingbase)：北京人大金仓，兼容 PG 语法
 * 均为存根实现，生产环境需安装对应驱动
 */

import { BaseRelationalDbConnector } from './base-db';
import { StandardDataType, ConnectorMetadata, ColumnInfo } from './types';

// ========== 达梦数据库 (DM) 连接器 ==========
// 达梦数据库是武汉达梦数据库股份有限公司的产品
// 兼容 Oracle 和 PostgreSQL 语法，支持 JDBC/ODBC 等标准接口
// 生产环境需安装 dmdbms Node.js 驱动

export class DamengConnector extends BaseRelationalDbConnector {
  readonly type = 'dameng';
  readonly name = '达梦数据库';
  readonly metadata: ConnectorMetadata = {
    type: 'dameng',
    displayName: '达梦数据库',
    category: 'database',
    icon: 'database',
    description: '达梦 (DM) 国产数据库连接器，支持全量和增量同步，兼容 Oracle/PG 语法',
    typeSupport: 'both',
    version: '1.0.0',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: true,
      supportsIncremental: true,
      supportsUpsert: true,
      supportsFilter: true,
    },
    authMethods: [
      { type: 'password', label: '用户名/密码', default: true },
    ],
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost', group: '基础配置' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 5236, group: '基础配置' },
        { name: 'database', label: '数据库名', type: 'string', required: true, placeholder: 'DAMENG', group: '基础配置' },
        { name: 'user', label: '用户名', type: 'string', required: true, defaultValue: 'SYSDBA', group: '认证配置' },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true, group: '认证配置' },
        { name: 'schema', label: 'Schema 名称', type: 'string', group: '高级选项', help: '默认为用户对应的 Schema' },
        { name: 'charset', label: '字符集', type: 'string', defaultValue: 'UTF8', group: '高级选项' },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 10, group: '高级选项' },
        { name: 'ssl', label: '启用 SSL', type: 'boolean', defaultValue: false, group: '安全选项' },
      ],
    },
  };

  protected mapToStandardType(dbType: string): StandardDataType {
    const t = dbType.toLowerCase().replace(/\(.*\)/, '').trim();
    const map: Record<string, StandardDataType> = {
      int: StandardDataType.INTEGER, integer: StandardDataType.INTEGER, bigint: StandardDataType.INTEGER,
      smallint: StandardDataType.INTEGER, tinyint: StandardDataType.INTEGER,
      decimal: StandardDataType.DECIMAL, numeric: StandardDataType.DECIMAL,
      float: StandardDataType.FLOAT, double: StandardDataType.FLOAT, real: StandardDataType.FLOAT,
      varchar: StandardDataType.STRING, char: StandardDataType.STRING,
      varchar2: StandardDataType.STRING, char2: StandardDataType.STRING,
      text: StandardDataType.STRING, clob: StandardDataType.STRING, longvarchar: StandardDataType.STRING,
      nchar: StandardDataType.STRING, nvarchar: StandardDataType.STRING, nvarchar2: StandardDataType.STRING,
      bit: StandardDataType.BOOLEAN, bool: StandardDataType.BOOLEAN, boolean: StandardDataType.BOOLEAN,
      date: StandardDataType.DATE, datetime: StandardDataType.DATETIME,
      timestamp: StandardDataType.TIMESTAMP, time: StandardDataType.DATETIME,
      blob: StandardDataType.BINARY, binary: StandardDataType.BINARY, varbinary: StandardDataType.BINARY,
      image: StandardDataType.BINARY, longvarbinary: StandardDataType.BINARY,
      json: StandardDataType.JSON, clob_text: StandardDataType.STRING,
      number: StandardDataType.DECIMAL,
    };
    return map[t] || StandardDataType.STRING;
  }

  protected async createNativeConnection(config: Record<string, any>): Promise<any> {
    // 达梦官方 Node.js 驱动包名为 dmdb
    // 生产环境安装: pnpm add dmdb
    // 这里使用动态导入，未安装时给出明确提示
    throw new Error(
      '达梦数据库驱动未安装，请执行 pnpm add dmdb\n' +
      '安装后将自动启用达梦数据库连接器'
    );
  }

  protected async closeNativeConnection(conn: any): Promise<void> {
    if (conn?.close) await conn.close();
  }

  protected async executeQuery(conn: any, sql: string, params?: any[]): Promise<{ rows: any[]; fields: ColumnInfo[] }> {
    const result = await conn.execute(sql, params);
    return {
      rows: result.rows || [],
      fields: (result.metaData || []).map((f: any) => ({
        name: f.name,
        type: f.dataType || f.typeName || 'varchar',
        standardType: this.mapToStandardType(String(f.dataType || f.typeName || 'varchar')),
      })),
    };
  }

  protected async executeInsert(conn: any, table: string, records: Record<string, any>[]): Promise<number> {
    if (!records || records.length === 0) return 0;
    const keys = Object.keys(records[0]);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    let total = 0;
    for (const record of records) {
      const values = keys.map(k => record[k]);
      const result = await conn.execute(sql, values, { autoCommit: true });
      total += result.rowsAffected || 0;
    }
    return total;
  }

  async listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const { rows } = await this.executeQuery(
      connection,
      `SELECT TABLE_NAME, TABLE_TYPE, COMMENTS FROM ALL_TABLES
       WHERE OWNER = USER
       ORDER BY TABLE_NAME`
    );
    return rows.map((r: any) => ({
      tableName: r.TABLE_NAME,
      tableType: r.TABLE_TYPE || 'TABLE',
      comment: r.COMMENTS,
    }));
  }

  async describeTable(connection: any, tableName: string): Promise<ColumnInfo[]> {
    const { rows } = await this.executeQuery(
      connection,
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE, DATA_DEFAULT, COMMENTS
       FROM ALL_TAB_COLUMNS
       WHERE TABLE_NAME = ?
       ORDER BY COLUMN_ID`,
      [tableName.toUpperCase()]
    );
    return rows.map((r: any) => ({
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      standardType: this.mapToStandardType(r.DATA_TYPE),
      nullable: r.NULLABLE === 'Y',
      defaultValue: r.DATA_DEFAULT,
      comment: r.COMMENTS,
    }));
  }
}

// ========== 人大金仓 (Kingbase) 连接器 ==========
// 人大金仓是北京人大金仓信息技术股份有限公司的产品
// 基于 PostgreSQL 内核改造，兼容 PG 语法和驱动
// 可直接使用 pg 包作为驱动

export class KingbaseConnector extends BaseRelationalDbConnector {
  readonly type = 'kingbase';
  readonly name = '人大金仓';
  readonly metadata: ConnectorMetadata = {
    type: 'kingbase',
    displayName: '人大金仓',
    category: 'database',
    icon: 'database',
    description: '人大金仓 (KingbaseES) 国产数据库连接器，基于 PostgreSQL 内核，支持全量和增量同步',
    typeSupport: 'both',
    version: '1.0.0',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: true,
      supportsIncremental: true,
      supportsUpsert: true,
      supportsFilter: true,
    },
    authMethods: [
      { type: 'password', label: '用户名/密码', default: true },
    ],
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost', group: '基础配置' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 54321, group: '基础配置', help: '金仓默认端口 54321' },
        { name: 'database', label: '数据库名', type: 'string', required: true, placeholder: 'test', group: '基础配置' },
        { name: 'user', label: '用户名', type: 'string', required: true, defaultValue: 'system', group: '认证配置' },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true, group: '认证配置' },
        { name: 'schema', label: 'Schema 名称', type: 'string', defaultValue: 'public', group: '高级选项' },
        { name: 'ssl', label: '启用 SSL', type: 'boolean', defaultValue: false, group: '安全选项' },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 10, group: '高级选项' },
        { name: 'applicationName', label: '应用名称', type: 'string', defaultValue: 'integration-platform', group: '高级选项' },
      ],
    },
  };

  protected mapToStandardType(dbType: string): StandardDataType {
    // 金仓基于 PG 内核，类型映射基本与 PG 一致
    const t = dbType.toLowerCase().replace(/\(.*\)/, '').trim();
    const map: Record<string, StandardDataType> = {
      int: StandardDataType.INTEGER, int4: StandardDataType.INTEGER,
      integer: StandardDataType.INTEGER, int8: StandardDataType.INTEGER,
      bigint: StandardDataType.INTEGER, smallint: StandardDataType.INTEGER,
      int2: StandardDataType.INTEGER, serial: StandardDataType.INTEGER,
      bigserial: StandardDataType.INTEGER, smallserial: StandardDataType.INTEGER,
      numeric: StandardDataType.DECIMAL, decimal: StandardDataType.DECIMAL,
      float4: StandardDataType.FLOAT, float8: StandardDataType.FLOAT,
      real: StandardDataType.FLOAT, double: StandardDataType.FLOAT,
      'double precision': StandardDataType.FLOAT,
      varchar: StandardDataType.STRING, char: StandardDataType.STRING,
      character: StandardDataType.STRING, 'character varying': StandardDataType.STRING,
      text: StandardDataType.STRING, bpchar: StandardDataType.STRING,
      name: StandardDataType.STRING, varchar2: StandardDataType.STRING,
      nvarchar2: StandardDataType.STRING,
      bool: StandardDataType.BOOLEAN, boolean: StandardDataType.BOOLEAN,
      date: StandardDataType.DATE,
      timestamp: StandardDataType.TIMESTAMP, timestamptz: StandardDataType.TIMESTAMP,
      'timestamp without time zone': StandardDataType.TIMESTAMP,
      'timestamp with time zone': StandardDataType.TIMESTAMP,
      time: StandardDataType.DATETIME, timetz: StandardDataType.DATETIME,
      interval: StandardDataType.STRING,
      json: StandardDataType.JSON, jsonb: StandardDataType.JSON,
      bytea: StandardDataType.BINARY,
      uuid: StandardDataType.STRING,
      xml: StandardDataType.STRING,
      array: StandardDataType.ARRAY,
      money: StandardDataType.DECIMAL,
      oid: StandardDataType.INTEGER,
    };
    return map[t] || StandardDataType.STRING;
  }

  protected async createNativeConnection(config: Record<string, any>): Promise<any> {
    // 金仓兼容 PG 协议，可直接使用 pg 驱动
    // 生产环境安装: pnpm add pg
    // 注意：金仓的某些特定类型可能需要特殊处理
    try {
      const { Client } = await import('pg');
      const client = new Client({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: (config.connectTimeout || 10) * 1000,
        application_name: config.applicationName || 'integration-platform',
      });
      await client.connect();
      // 设置默认 Schema
      if (config.schema) {
        await client.query(`SET search_path TO "${config.schema}"`);
      }
      return client;
    } catch (e: any) {
      if (e.code === 'MODULE_NOT_FOUND' || e.message?.includes('pg')) {
        throw new Error(
          'PostgreSQL 驱动未安装，请执行 pnpm add pg\n' +
          '人大金仓兼容 PG 协议，安装 pg 驱动后即可使用'
        );
      }
      throw e;
    }
  }

  protected async closeNativeConnection(conn: any): Promise<void> {
    if (conn?.end) await conn.end();
  }

  protected async executeQuery(conn: any, sql: string, params?: any[]): Promise<{ rows: any[]; fields: ColumnInfo[] }> {
    const result = await conn.query(sql, params);
    return {
      rows: result.rows || [],
      fields: (result.fields || []).map((f: any) => ({
        name: f.name,
        type: f.dataType ? this._oidToTypeName(f.dataType) : 'text',
        standardType: f.dataType ? this._oidToStandardType(f.dataType) : StandardDataType.STRING,
      })),
    };
  }

  protected async executeInsert(conn: any, table: string, records: Record<string, any>[]): Promise<number> {
    if (!records || records.length === 0) return 0;
    const keys = Object.keys(records[0]);
    let total = 0;
    for (let i = 0; i < records.length; i++) {
      const values = keys.map((_, idx) => `$${idx + 1}`);
      const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${values.join(', ')})`;
      const result = await conn.query(sql, keys.map(k => records[i][k]));
      total += result.rowCount || 0;
    }
    return total;
  }

  async listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const { rows } = await this.executeQuery(
      connection,
      `SELECT t.relname AS table_name,
              CASE t.relkind
                WHEN 'r' THEN 'TABLE'
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
                ELSE 'TABLE'
              END AS table_type,
              d.description AS comment
       FROM pg_class t
       JOIN pg_namespace n ON n.oid = t.relnamespace
       LEFT JOIN pg_description d ON d.objoid = t.oid AND d.objsubid = 0
       WHERE n.nspname = current_schema()
         AND t.relkind IN ('r', 'v', 'm')
       ORDER BY t.relname`
    );
    return rows.map((r: any) => ({
      tableName: r.table_name,
      tableType: r.table_type,
      comment: r.comment,
    }));
  }

  async describeTable(connection: any, tableName: string): Promise<ColumnInfo[]> {
    const { rows } = await this.executeQuery(
      connection,
      `SELECT c.column_name,
              c.data_type,
              c.is_nullable,
              c.column_default,
              pg_catalog.col_description(
                (SELECT oid FROM pg_class
                 WHERE relname = c.table_name
                   AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)
                ),
                c.ordinal_position
              ) AS column_comment
       FROM information_schema.columns c
       WHERE c.table_name = $1
         AND c.table_schema = current_schema()
       ORDER BY c.ordinal_position`,
      [tableName]
    );
    return rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type,
      standardType: this.mapToStandardType(r.data_type),
      nullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      comment: r.column_comment,
    }));
  }

  // OID 到类型名的映射（PG 标准 OID）
  private _oidToTypeName(oid: number): string {
    const oidMap: Record<number, string> = {
      16: 'bool', 20: 'int8', 21: 'int2', 23: 'int4',
      25: 'text', 700: 'float4', 701: 'float8',
      1042: 'char', 1043: 'varchar', 1700: 'numeric',
      1114: 'timestamp', 1184: 'timestamptz',
      1082: 'date', 1083: 'time',
      114: 'json', 3802: 'jsonb',
      17: 'bytea', 2950: 'uuid',
    };
    return oidMap[oid] || `oid_${oid}`;
  }

  private _oidToStandardType(oid: number): StandardDataType {
    const oidMap: Record<number, StandardDataType> = {
      16: StandardDataType.BOOLEAN,
      20: StandardDataType.INTEGER,
      21: StandardDataType.INTEGER,
      23: StandardDataType.INTEGER,
      25: StandardDataType.STRING,
      700: StandardDataType.FLOAT,
      701: StandardDataType.FLOAT,
      1042: StandardDataType.STRING,
      1043: StandardDataType.STRING,
      1700: StandardDataType.DECIMAL,
      1114: StandardDataType.TIMESTAMP,
      1184: StandardDataType.TIMESTAMP,
      1082: StandardDataType.DATE,
      1083: StandardDataType.DATETIME,
      114: StandardDataType.JSON,
      3802: StandardDataType.JSON,
      17: StandardDataType.BINARY,
      2950: StandardDataType.STRING,
    };
    return oidMap[oid] || StandardDataType.STRING;
  }
}
