import { BaseRelationalDbConnector } from './base-db';
import { StandardDataType, ConnectorMetadata, ColumnInfo } from './types';

/**
 * MySQL 连接器
 * 生产环境需安装 mysql2: pnpm add mysql2
 * 当前为存根实现，返回正确的元数据，运行时调用会提示安装驱动
 */
export class MysqlConnector extends BaseRelationalDbConnector {
  readonly type = 'mysql';
  readonly name = 'MySQL';
  readonly metadata: ConnectorMetadata = {
    type: 'mysql',
    name: 'MySQL',
    category: 'database',
    description: 'MySQL / MariaDB 数据库连接器，支持全量和增量同步',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 3306 },
        { name: 'database', label: '数据库名', type: 'string', required: true, placeholder: 'mydb' },
        { name: 'user', label: '用户名', type: 'string', required: true },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true },
        { name: 'charset', label: '字符集', type: 'string', defaultValue: 'utf8mb4' },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 10 },
      ],
    },
  };

  protected mapToStandardType(dbType: string): StandardDataType {
    const t = dbType.toLowerCase().replace(/\(.*\)/, '').trim();
    const map: Record<string, StandardDataType> = {
      int: StandardDataType.INTEGER, integer: StandardDataType.INTEGER, bigint: StandardDataType.INTEGER,
      smallint: StandardDataType.INTEGER, tinyint: StandardDataType.INTEGER, mediumint: StandardDataType.INTEGER,
      decimal: StandardDataType.DECIMAL, numeric: StandardDataType.DECIMAL,
      float: StandardDataType.FLOAT, double: StandardDataType.FLOAT, real: StandardDataType.FLOAT,
      varchar: StandardDataType.STRING, char: StandardDataType.STRING, text: StandardDataType.STRING,
      tinytext: StandardDataType.STRING, mediumtext: StandardDataType.STRING, longtext: StandardDataType.STRING,
      enum: StandardDataType.STRING, set: StandardDataType.STRING, json: StandardDataType.JSON,
      date: StandardDataType.DATE, datetime: StandardDataType.DATETIME,
      timestamp: StandardDataType.TIMESTAMP, time: StandardDataType.DATETIME, year: StandardDataType.INTEGER,
      binary: StandardDataType.BINARY, varbinary: StandardDataType.BINARY, blob: StandardDataType.BINARY,
      tinyblob: StandardDataType.BINARY, mediumblob: StandardDataType.BINARY, longblob: StandardDataType.BINARY,
      bit: StandardDataType.BOOLEAN, bool: StandardDataType.BOOLEAN, boolean: StandardDataType.BOOLEAN,
    };
    return map[t] || StandardDataType.STRING;
  }

  protected async createNativeConnection(config: Record<string, any>): Promise<any> {
    throw new Error('MySQL 驱动未安装，请执行 pnpm add mysql2');
  }
  protected async closeNativeConnection(conn: any): Promise<void> {
    if (conn?.end) await conn.end();
  }
  protected async executeQuery(conn: any, sql: string, params?: any[]): Promise<{ rows: any[]; fields: ColumnInfo[] }> {
    const [rows, fields] = await conn.query(sql, params);
    return { rows, fields: fields?.map((f: any) => ({
      name: f.name, type: f.type, standardType: this.mapToStandardType(String(f.type)),
    })) || [] };
  }
  protected async executeInsert(conn: any, table: string, records: Record<string, any>[]): Promise<number> {
    const keys = Object.keys(records[0]);
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES ?`;
    const values = records.map(r => keys.map(k => r[k]));
    const [result] = await conn.query(sql, [values]);
    return result.affectedRows;
  }

  async listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const { rows } = await this.executeQuery(connection, 'SHOW TABLE STATUS');
    return rows.map((r: any) => ({
      tableName: r.Name,
      tableType: r.Engine ? 'TABLE' : r.Comment === 'VIEW' ? 'VIEW' : 'TABLE',
      comment: r.Comment,
    }));
  }

  async describeTable(connection: any, tableName: string): Promise<ColumnInfo[]> {
    const { rows } = await this.executeQuery(connection, `DESCRIBE ${tableName}`);
    return rows.map((r: any) => ({
      name: r.Field,
      type: r.Type,
      standardType: this.mapToStandardType(r.Type),
      nullable: r.Null === 'YES',
      defaultValue: r.Default,
      primaryKey: r.Key === 'PRI',
    }));
  }
}

/**
 * PostgreSQL 连接器
 * 生产环境需安装 pg: pnpm add pg
 */
export class PostgresConnector extends BaseRelationalDbConnector {
  readonly type = 'postgresql';
  readonly name = 'PostgreSQL';
  readonly metadata: ConnectorMetadata = {
    type: 'postgresql',
    name: 'PostgreSQL',
    category: 'database',
    description: 'PostgreSQL 数据库连接器，支持全量和增量同步',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 5432 },
        { name: 'database', label: '数据库名', type: 'string', required: true },
        { name: 'user', label: '用户名', type: 'string', required: true },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true },
        { name: 'schema', label: 'Schema', type: 'string', defaultValue: 'public' },
        { name: 'ssl', label: '启用SSL', type: 'boolean', defaultValue: false },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 10 },
      ],
    },
  };

  protected mapToStandardType(dbType: string): StandardDataType {
    const t = dbType.toLowerCase().replace(/\(.*\)/, '').trim();
    const map: Record<string, StandardDataType> = {
      smallint: StandardDataType.INTEGER, integer: StandardDataType.INTEGER,
      bigint: StandardDataType.INTEGER, serial: StandardDataType.INTEGER,
      bigserial: StandardDataType.INTEGER, int2: StandardDataType.INTEGER,
      int4: StandardDataType.INTEGER, int8: StandardDataType.INTEGER,
      numeric: StandardDataType.DECIMAL, decimal: StandardDataType.DECIMAL,
      real: StandardDataType.FLOAT, float4: StandardDataType.FLOAT,
      'double precision': StandardDataType.FLOAT, float8: StandardDataType.FLOAT,
      varchar: StandardDataType.STRING, char: StandardDataType.STRING,
      text: StandardDataType.STRING, bpchar: StandardDataType.STRING,
      character: StandardDataType.STRING, 'character varying': StandardDataType.STRING,
      json: StandardDataType.JSON, jsonb: StandardDataType.JSON,
      date: StandardDataType.DATE, timestamp: StandardDataType.DATETIME,
      timestamptz: StandardDataType.DATETIME, 'timestamp with time zone': StandardDataType.DATETIME,
      time: StandardDataType.DATETIME, timetz: StandardDataType.DATETIME,
      interval: StandardDataType.STRING, bool: StandardDataType.BOOLEAN, boolean: StandardDataType.BOOLEAN,
      bytea: StandardDataType.BINARY, uuid: StandardDataType.STRING,
      array: StandardDataType.ARRAY, _text: StandardDataType.ARRAY, _int4: StandardDataType.ARRAY,
    };
    return map[t] || StandardDataType.STRING;
  }

  protected async createNativeConnection(config: Record<string, any>): Promise<any> {
    throw new Error('PostgreSQL 驱动未安装，请执行 pnpm add pg');
  }
  protected async closeNativeConnection(conn: any): Promise<void> {
    if (conn?.end) await conn.end();
  }
  protected async executeQuery(conn: any, sql: string, params?: any[]): Promise<{ rows: any[]; fields: ColumnInfo[] }> {
    const result = await conn.query(sql, params);
    return {
      rows: result.rows,
      fields: result.fields.map((f: any) => ({
        name: f.name, type: f.dataTypeID, standardType: StandardDataType.STRING,
      })),
    };
  }
  protected async executeInsert(conn: any, table: string, records: Record<string, any>[]): Promise<number> {
    const keys = Object.keys(records[0]);
    const placeholders = records.map((_, i) =>
      `(${keys.map((_, j) => `$${i * keys.length + j + 1}`).join(', ')})`
    ).join(', ');
    const values = records.flatMap(r => keys.map(k => r[k]));
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES ${placeholders}`;
    const result = await conn.query(sql, values);
    return result.rowCount;
  }

  async listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const schema = connection?.searchPath?.[0] || 'public';
    const sql = `
      SELECT t.table_name, t.table_type, pg_catalog.obj_description(pc.oid, 'pg_class') as table_comment
      FROM information_schema.tables t
      LEFT JOIN pg_class pc ON pc.relname = t.table_name
      WHERE t.table_schema = $1
      ORDER BY t.table_name
    `;
    const { rows } = await this.executeQuery(connection, sql, [schema]);
    return rows.map((r: any) => ({
      tableName: r.table_name,
      tableType: r.table_type,
      comment: r.table_comment,
    }));
  }

  async describeTable(connection: any, tableName: string): Promise<ColumnInfo[]> {
    const sql = `
      SELECT
        c.column_name, c.data_type, c.is_nullable, c.column_default,
        c.udt_name, c.character_maximum_length, c.numeric_precision,
        (SELECT true FROM information_schema.key_column_usage k
         JOIN information_schema.table_constraints tc ON k.constraint_name = tc.constraint_name
         WHERE k.table_name = c.table_name AND k.column_name = c.column_name
           AND tc.constraint_type = 'PRIMARY KEY') as is_primary
      FROM information_schema.columns c
      WHERE c.table_name = $1
      ORDER BY c.ordinal_position
    `;
    const { rows } = await this.executeQuery(connection, sql, [tableName]);
    return rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type,
      standardType: this.mapToStandardType(r.data_type),
      nullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      primaryKey: !!r.is_primary,
    }));
  }
}

/**
 * Oracle 连接器
 * 生产环境需安装 oracledb: pnpm add oracledb
 */
export class OracleConnector extends BaseRelationalDbConnector {
  readonly type = 'oracle';
  readonly name = 'Oracle';
  readonly metadata: ConnectorMetadata = {
    type: 'oracle',
    name: 'Oracle Database',
    category: 'database',
    description: 'Oracle 数据库连接器，支持全量和增量同步，适用于金融、央企等大型企业核心系统',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 1521 },
        { name: 'serviceName', label: '服务名/SID', type: 'string', required: true },
        { name: 'isSid', label: '使用SID方式', type: 'boolean', defaultValue: false },
        { name: 'user', label: '用户名', type: 'string', required: true },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true },
        { name: 'schema', label: 'Schema', type: 'string', description: '不填默认当前用户' },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 15 },
        { name: 'poolMax', label: '最大连接数', type: 'number', defaultValue: 10 },
      ],
    },
  };

  protected mapToStandardType(dbType: string): StandardDataType {
    const t = dbType.toUpperCase().replace(/\(.*\)/, '').trim();
    const map: Record<string, StandardDataType> = {
      NUMBER: StandardDataType.DECIMAL, NUMERIC: StandardDataType.DECIMAL,
      INTEGER: StandardDataType.INTEGER, INT: StandardDataType.INTEGER,
      SMALLINT: StandardDataType.INTEGER, FLOAT: StandardDataType.FLOAT,
      BINARY_FLOAT: StandardDataType.FLOAT, BINARY_DOUBLE: StandardDataType.FLOAT,
      VARCHAR2: StandardDataType.STRING, VARCHAR: StandardDataType.STRING,
      CHAR: StandardDataType.STRING, NCHAR: StandardDataType.STRING,
      NVARCHAR2: StandardDataType.STRING, CLOB: StandardDataType.STRING,
      NCLOB: StandardDataType.STRING, LONG: StandardDataType.STRING,
      DATE: StandardDataType.DATETIME, TIMESTAMP: StandardDataType.DATETIME,
      'TIMESTAMP WITH TIME ZONE': StandardDataType.DATETIME,
      'TIMESTAMP WITH LOCAL TIME ZONE': StandardDataType.DATETIME,
      RAW: StandardDataType.BINARY, BLOB: StandardDataType.BINARY,
      BFILE: StandardDataType.BINARY, 'LONG RAW': StandardDataType.BINARY,
      BOOLEAN: StandardDataType.BOOLEAN, JSON: StandardDataType.JSON,
    };
    return map[t] || StandardDataType.STRING;
  }

  protected async createNativeConnection(config: Record<string, any>): Promise<any> {
    throw new Error('Oracle 驱动未安装，请执行 pnpm add oracledb');
  }
  protected async closeNativeConnection(conn: any): Promise<void> {
    if (conn?.close) await conn.close();
  }
  protected async executeQuery(conn: any, sql: string, params?: any[]): Promise<{ rows: any[]; fields: ColumnInfo[] }> {
    const result = await conn.execute(sql, params, { outFormat: 4002 });
    return {
      rows: result.rows,
      fields: result.metaData.map((m: any) => ({
        name: m.name, type: String(m.dbType), standardType: this.mapToStandardType(String(m.dbType)),
      })),
    };
  }
  protected async executeInsert(conn: any, table: string, records: Record<string, any>[]): Promise<number> {
    const keys = Object.keys(records[0]);
    const placeholders = keys.map(k => `:${k}`).join(', ');
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    let total = 0;
    for (const record of records) {
      const result = await conn.execute(sql, record, { autoCommit: false });
      total += result.rowsAffected;
    }
    await conn.commit();
    return total;
  }

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.host) errors.push('主机地址不能为空');
    if (!config.port) errors.push('端口不能为空');
    if (!config.serviceName) errors.push('服务名/SID不能为空');
    if (!config.user) errors.push('用户名不能为空');
    if (!config.password) errors.push('密码不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const sql = `
      SELECT t.table_name, t.table_type, c.comments
      FROM user_tables t
      LEFT JOIN user_tab_comments c ON c.table_name = t.table_name
      UNION ALL
      SELECT v.view_name, 'VIEW', c.comments
      FROM user_views v
      LEFT JOIN user_tab_comments c ON c.table_name = v.view_name
      ORDER BY 1
    `;
    const { rows } = await this.executeQuery(connection, sql);
    return rows.map((r: any) => ({
      tableName: r.TABLE_NAME,
      tableType: r.TABLE_TYPE || 'TABLE',
      comment: r.COMMENTS,
    }));
  }

  async describeTable(connection: any, tableName: string): Promise<ColumnInfo[]> {
    const sql = `
      SELECT
        c.column_name, c.data_type, c.nullable, c.data_default,
        (SELECT LISTAGG(col.column_name, ',') WITHIN GROUP (ORDER BY col.column_name)
         FROM user_constraints cons
         JOIN user_cons_columns col ON cons.constraint_name = col.constraint_name
         WHERE cons.table_name = c.table_name AND cons.constraint_type = 'P'
           AND col.column_name = c.column_name) as is_primary,
        c.data_precision, c.data_scale, c.data_length
      FROM user_tab_columns c
      WHERE c.table_name = :tableName
      ORDER BY c.column_id
    `;
    const { rows } = await this.executeQuery(connection, sql, [tableName]);
    return rows.map((r: any) => ({
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      standardType: this.mapToStandardType(r.DATA_TYPE),
      nullable: r.NULLABLE === 'Y',
      defaultValue: r.DATA_DEFAULT,
      primaryKey: !!r.IS_PRIMARY,
    }));
  }
}

/**
 * SQL Server 连接器
 * 生产环境需安装 mssql: pnpm add mssql
 */
export class SqlServerConnector extends BaseRelationalDbConnector {
  readonly type = 'sqlserver';
  readonly name = 'SQL Server';
  readonly metadata: ConnectorMetadata = {
    type: 'sqlserver',
    name: 'SQL Server',
    category: 'database',
    description: 'Microsoft SQL Server 数据库连接器，支持全量和增量同步，适用于微软生态企业',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 1433 },
        { name: 'database', label: '数据库名', type: 'string', required: true },
        { name: 'authType', label: '认证方式', type: 'select', required: true,
          defaultValue: 'sqlserver',
          options: [
            { label: 'SQL Server 认证', value: 'sqlserver' },
            { label: 'Windows 认证', value: 'ntlm' },
            { label: 'Azure Active Directory', value: 'azure-active-directory-password' },
          ] },
        { name: 'user', label: '用户名', type: 'string', required: true },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true },
        { name: 'domain', label: '域', type: 'string', description: 'Windows认证时需要' },
        { name: 'encrypt', label: '加密连接', type: 'boolean', defaultValue: true },
        { name: 'trustServerCertificate', label: '信任服务器证书', type: 'boolean', defaultValue: false },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 15 },
      ],
    },
  };

  protected mapToStandardType(dbType: string): StandardDataType {
    const t = dbType.toLowerCase().replace(/\(.*\)/, '').trim();
    const map: Record<string, StandardDataType> = {
      int: StandardDataType.INTEGER, bigint: StandardDataType.INTEGER,
      smallint: StandardDataType.INTEGER, tinyint: StandardDataType.INTEGER,
      decimal: StandardDataType.DECIMAL, numeric: StandardDataType.DECIMAL,
      money: StandardDataType.DECIMAL, smallmoney: StandardDataType.DECIMAL,
      float: StandardDataType.FLOAT, real: StandardDataType.FLOAT,
      varchar: StandardDataType.STRING, char: StandardDataType.STRING,
      text: StandardDataType.STRING, nvarchar: StandardDataType.STRING,
      nchar: StandardDataType.STRING, ntext: StandardDataType.STRING,
      date: StandardDataType.DATE, datetime: StandardDataType.DATETIME,
      datetime2: StandardDataType.DATETIME, smalldatetime: StandardDataType.DATETIME,
      datetimeoffset: StandardDataType.DATETIME, time: StandardDataType.DATETIME,
      timestamp: StandardDataType.BINARY, rowversion: StandardDataType.BINARY,
      bit: StandardDataType.BOOLEAN, uniqueidentifier: StandardDataType.STRING,
      binary: StandardDataType.BINARY, varbinary: StandardDataType.BINARY,
      image: StandardDataType.BINARY, xml: StandardDataType.JSON,
      sql_variant: StandardDataType.STRING,
    };
    return map[t] || StandardDataType.STRING;
  }

  protected async createNativeConnection(config: Record<string, any>): Promise<any> {
    throw new Error('SQL Server 驱动未安装，请执行 pnpm add mssql');
  }
  protected async closeNativeConnection(conn: any): Promise<void> {
    if (conn?.close) await conn.close();
  }
  protected async executeQuery(conn: any, sql: string, params?: any[]): Promise<{ rows: any[]; fields: ColumnInfo[] }> {
    const result = await conn.request().query(sql);
    return {
      rows: result.recordset,
      fields: result.columns.map((c: any) => ({
        name: c.name, type: c.type.name, standardType: this.mapToStandardType(c.type.name),
      })),
    };
  }
  protected async executeInsert(conn: any, table: string, records: Record<string, any>[]): Promise<number> {
    const keys = Object.keys(records[0]);
    const columns = keys.join(', ');
    let total = 0;
    for (const record of records) {
      const placeholders = keys.map(k => `@${k}`).join(', ');
      const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`;
      const req = conn.request();
      keys.forEach(k => req.input(k, record[k]));
      const result = await req.query(sql);
      total += result.rowsAffected[0];
    }
    return total;
  }

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.host) errors.push('主机地址不能为空');
    if (!config.port) errors.push('端口不能为空');
    if (!config.database) errors.push('数据库名不能为空');
    if (!config.user) errors.push('用户名不能为空');
    if (!config.password) errors.push('密码不能为空');
    if (config.authType === 'ntlm' && !config.domain) errors.push('Windows认证需要填写域');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async listTables(connection: any): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const sql = `
      SELECT
        t.TABLE_NAME as table_name,
        t.TABLE_TYPE as table_type,
        ep.value as table_comment
      FROM INFORMATION_SCHEMA.TABLES t
      LEFT JOIN sys.tables st ON st.name = t.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
      LEFT JOIN sys.extended_properties ep ON ep.major_id = st.object_id
        AND ep.minor_id = 0 AND ep.name = 'MS_Description'
      WHERE t.TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY t.TABLE_NAME
    `;
    const { rows } = await this.executeQuery(connection, sql);
    return rows.map((r: any) => ({
      tableName: r.table_name,
      tableType: r.table_type === 'VIEW' ? 'VIEW' : 'TABLE',
      comment: r.table_comment,
    }));
  }

  async describeTable(connection: any, tableName: string): Promise<ColumnInfo[]> {
    const sql = `
      SELECT
        c.COLUMN_NAME as column_name,
        c.DATA_TYPE as data_type,
        c.IS_NULLABLE as is_nullable,
        c.COLUMN_DEFAULT as column_default,
        CAST(COLUMNPROPERTY(OBJECT_ID(c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') AS BIT) as is_identity,
        CASE WHEN EXISTS (
          SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
          WHERE kcu.TABLE_NAME = c.TABLE_NAME AND kcu.COLUMN_NAME = c.COLUMN_NAME
            AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) THEN 1 ELSE 0 END as is_primary
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION
    `;
    const { rows } = await this.executeQuery(connection, sql.replace('@tableName', `'${tableName}'`));
    return rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type,
      standardType: this.mapToStandardType(r.data_type),
      nullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      primaryKey: !!r.is_primary,
    }));
  }
}
