/**
 * NoSQL 连接器：MongoDB + Elasticsearch
 * 用于文档数据库和搜索引擎的数据同步
 */

import type {
  IConnector,
  ConnectorMetadata,
  ConnectionTestResult,
  ConfigValidationResult,
} from './base';
import { StandardDataType } from './types';

// ========== MongoDB Connector ==========

export class MongoDBConnector implements IConnector {
  readonly type = 'mongodb';
  readonly name = 'MongoDB';
  readonly metadata: ConnectorMetadata = {
    type: 'mongodb',
    displayName: 'MongoDB',
    category: 'database',
    icon: 'database',
    description: 'MongoDB 文档数据库连接器，支持集合 CRUD、聚合查询和增量同步',
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
      { type: 'anonymous', label: '无认证' },
      { type: 'iam', label: 'X.509 证书' },
    ],
    configSchema: {
      required: ['uri', 'database'],
      fields: [
        { name: 'uri', label: '连接 URI', type: 'string', required: true, placeholder: 'mongodb://user:pass@host:27017', group: '基础配置', help: 'MongoDB 标准连接字符串' },
        { name: 'database', label: '数据库名', type: 'string', required: true, placeholder: 'mydb', group: '基础配置' },
        { name: 'authSource', label: '认证数据库', type: 'string', defaultValue: 'admin', group: '认证配置' },
        { name: 'replicaSet', label: '副本集名称', type: 'string', group: '高级选项', help: '副本集模式下必填' },
        { name: 'readPreference', label: '读取偏好', type: 'select', defaultValue: 'primary',
          options: [
            { value: 'primary', label: '主节点' },
            { value: 'secondary', label: '从节点' },
            { value: 'nearest', label: '最近节点' },
          ], group: '高级选项' },
        { name: 'connectTimeoutMs', label: '连接超时(毫秒)', type: 'number', defaultValue: 10000, group: '高级选项' },
        { name: 'maxPoolSize', label: '最大连接池', type: 'number', defaultValue: 10, group: '高级选项' },
        { name: 'tls', label: '启用 TLS', type: 'boolean', defaultValue: false, group: '安全选项' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.uri) errors.push('连接 URI 不能为空');
    if (config.uri && !String(config.uri).startsWith('mongodb')) {
      errors.push('URI 必须以 mongodb:// 或 mongodb+srv:// 开头');
    }
    if (!config.database) errors.push('数据库名不能为空');
    return { valid: errors.length === 0, errors, warnings };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      return { success: false, message: validation.errors.join('; '), latencyMs: Date.now() - startTime };
    }

    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(config.uri as string, {
        connectTimeoutMS: (config.connectTimeoutMs as number) || 10000,
        maxPoolSize: 1,
      });
      await client.connect();
      const db = client.db(config.database as string);
      const adminInfo = await db.admin().ping();
      const latency = Date.now() - startTime;
      await client.close();
      return {
        success: true,
        message: 'MongoDB 连接成功',
        latencyMs: latency,
        serverVersion: adminInfo.version as string,
        details: { ok: adminInfo.ok },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const err = error as Error;
      return {
        success: false,
        message: `连接失败: ${err.message}`,
        latencyMs: latency,
        details: { error: err.name },
      };
    }
  }

  // ========= 类型映射 =========
  mapToStandardType(bsonType: string): StandardDataType {
    const map: Record<string, StandardDataType> = {
      string: StandardDataType.STRING,
      int: StandardDataType.INTEGER,
      long: StandardDataType.INTEGER,
      double: StandardDataType.FLOAT,
      decimal: StandardDataType.DECIMAL,
      bool: StandardDataType.BOOLEAN,
      date: StandardDataType.DATETIME,
      timestamp: StandardDataType.TIMESTAMP,
      object: StandardDataType.JSON,
      array: StandardDataType.ARRAY,
      objectId: StandardDataType.STRING,
      binData: StandardDataType.BINARY,
      null: StandardDataType.UNKNOWN,
      regex: StandardDataType.STRING,
    };
    return map[bsonType] || StandardDataType.STRING;
  }

  mapFromStandardType(type: StandardDataType): string {
    const map: Record<string, string> = {
      [StandardDataType.STRING]: 'string',
      [StandardDataType.INTEGER]: 'long',
      [StandardDataType.FLOAT]: 'double',
      [StandardDataType.DECIMAL]: 'decimal',
      [StandardDataType.BOOLEAN]: 'bool',
      [StandardDataType.DATE]: 'date',
      [StandardDataType.DATETIME]: 'date',
      [StandardDataType.TIMESTAMP]: 'timestamp',
      [StandardDataType.JSON]: 'object',
      [StandardDataType.BINARY]: 'binData',
      [StandardDataType.ARRAY]: 'array',
    };
    return map[type] || 'string';
  }

  // ========= 集合发现 =========
  async listCollections(config: Record<string, unknown>): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.uri as string, { maxPoolSize: 1 });
    try {
      await client.connect();
      const db = client.db(config.database as string);
      const collections = await db.listCollections().toArray();
      return collections.map(c => ({
        tableName: c.name,
        tableType: c.type === 'view' ? 'VIEW' : 'COLLECTION',
      }));
    } finally {
      await client.close();
    }
  }

  // ========= 文档读取 =========
  async findDocuments(
    config: Record<string, unknown>,
    collection: string,
    filter: Record<string, unknown> = {},
    options: { skip?: number; limit?: number; sort?: Record<string, unknown>; projection?: Record<string, unknown> } = {}
  ): Promise<{ records: Record<string, unknown>[]; total: number }> {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.uri as string);
    try {
      await client.connect();
      const col = client.db(config.database as string).collection(collection);
      const total = await col.countDocuments(filter);
      const cursor = col.find(filter, {
        skip: options.skip,
        limit: options.limit,
        sort: options.sort as any,
        projection: options.projection as any,
      });
      const records = await cursor.toArray();
      // 将 ObjectId 转为字符串
      const normalized = records.map(r => {
        const { _id, ...rest } = r;
        return { _id: _id?.toString(), ...rest };
      });
      return { records: normalized as Record<string, unknown>[], total };
    } finally {
      await client.close();
    }
  }

  // ========= 文档写入 =========
  async insertDocuments(
    config: Record<string, unknown>,
    collection: string,
    documents: Record<string, unknown>[]
  ): Promise<{ inserted: number; failed: number }> {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.uri as string);
    try {
      await client.connect();
      const col = client.db(config.database as string).collection(collection);
      const result = await col.insertMany(documents);
      return { inserted: result.insertedCount, failed: documents.length - result.insertedCount };
    } finally {
      await client.close();
    }
  }

  async updateDocuments(
    config: Record<string, unknown>,
    collection: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean; multi?: boolean } = {}
  ): Promise<{ matched: number; modified: number; upserted: number }> {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.uri as string);
    try {
      await client.connect();
      const col = client.db(config.database as string).collection(collection);
      if (options.multi) {
        const result = await col.updateMany(filter, { $set: update }, { upsert: options.upsert });
        return {
          matched: result.matchedCount,
          modified: result.modifiedCount,
          upserted: result.upsertedCount,
        };
      }
      const result = await col.updateOne(filter, { $set: update }, { upsert: options.upsert });
      return {
        matched: result.matchedCount,
        modified: result.modifiedCount,
        upserted: result.upsertedCount,
      };
    } finally {
      await client.close();
    }
  }

  // ========= 聚合查询 =========
  async aggregate(
    config: Record<string, unknown>,
    collection: string,
    pipeline: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(config.uri as string);
    try {
      await client.connect();
      const col = client.db(config.database as string).collection(collection);
      const result = await col.aggregate(pipeline).toArray();
      return result as Record<string, unknown>[];
    } finally {
      await client.close();
    }
  }
}

// ========== Elasticsearch Connector ==========

export class ElasticsearchConnector implements IConnector {
  readonly type = 'elasticsearch';
  readonly name = 'Elasticsearch';
  readonly metadata: ConnectorMetadata = {
    type: 'elasticsearch',
    displayName: 'Elasticsearch',
    category: 'database',
    icon: 'search',
    description: 'Elasticsearch 搜索引擎连接器，支持文档搜索、批量写入和增量同步',
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
      { type: 'anonymous', label: '无认证', default: true },
      { type: 'password', label: '用户名/密码' },
      { type: 'apikey', label: 'API Key' },
    ],
    configSchema: {
      required: ['nodes'],
      fields: [
        { name: 'nodes', label: '节点地址', type: 'string', required: true, placeholder: 'http://localhost:9200', group: '基础配置', help: '多个节点用逗号分隔' },
        { name: 'authType', label: '认证方式', type: 'select', defaultValue: 'none',
          options: [
            { value: 'none', label: '无认证' },
            { value: 'basic', label: 'Basic Auth' },
            { value: 'apikey', label: 'API Key' },
          ], group: '认证配置' },
        { name: 'username', label: '用户名', type: 'string', group: '认证配置', showWhen: { field: 'authType', value: 'basic' } },
        { name: 'password', label: '密码', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'basic' } },
        { name: 'apiKeyId', label: 'API Key ID', type: 'string', group: '认证配置', showWhen: { field: 'authType', value: 'apikey' } },
        { name: 'apiKeySecret', label: 'API Key Secret', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'apikey' } },
        { name: 'tls', label: '启用 TLS/SSL', type: 'boolean', defaultValue: false, group: '安全选项' },
        { name: 'caFingerprint', label: 'CA 指纹', type: 'string', group: '安全选项', help: '自签名证书时使用' },
        { name: 'requestTimeout', label: '请求超时(毫秒)', type: 'number', defaultValue: 30000, group: '高级选项' },
        { name: 'sniffOnStart', label: '启动时节点发现', type: 'boolean', defaultValue: false, group: '高级选项' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.nodes) errors.push('节点地址不能为空');
    if (config.authType === 'basic') {
      if (!config.username) errors.push('用户名不能为空');
      if (!config.password) errors.push('密码不能为空');
    }
    if (config.authType === 'apikey') {
      if (!config.apiKeyId) errors.push('API Key ID 不能为空');
      if (!config.apiKeySecret) errors.push('API Key Secret 不能为空');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      return { success: false, message: validation.errors.join('; '), latencyMs: Date.now() - startTime };
    }

    try {
      const { Client } = await import('@elastic/elasticsearch');
      const nodes = (config.nodes as string).split(',').map(n => n.trim());
      const client = new Client({
        nodes,
        requestTimeout: (config.requestTimeout as number) || 30000,
      });
      const info = await client.info();
      const latency = Date.now() - startTime;
      return {
        success: true,
        message: 'Elasticsearch 连接成功',
        latencyMs: latency,
        serverVersion: info.version?.number || 'unknown',
        details: { clusterName: info.cluster_name, clusterUuid: info.cluster_uuid },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      const err = error as Error;
      return {
        success: false,
        message: `连接失败: ${err.message}`,
        latencyMs: latency,
        details: { error: err.name },
      };
    }
  }

  // ========= 类型映射 =========
  mapToStandardType(esType: string): StandardDataType {
    const map: Record<string, StandardDataType> = {
      text: StandardDataType.STRING,
      keyword: StandardDataType.STRING,
      integer: StandardDataType.INTEGER,
      long: StandardDataType.INTEGER,
      short: StandardDataType.INTEGER,
      byte: StandardDataType.INTEGER,
      double: StandardDataType.FLOAT,
      float: StandardDataType.FLOAT,
      half_float: StandardDataType.FLOAT,
      scaled_float: StandardDataType.DECIMAL,
      boolean: StandardDataType.BOOLEAN,
      date: StandardDataType.DATETIME,
      date_nanos: StandardDataType.TIMESTAMP,
      object: StandardDataType.JSON,
      nested: StandardDataType.JSON,
      binary: StandardDataType.BINARY,
      geo_point: StandardDataType.JSON,
      ip: StandardDataType.STRING,
      join: StandardDataType.STRING,
      rank_feature: StandardDataType.FLOAT,
      dense_vector: StandardDataType.JSON,
    };
    return map[esType] || StandardDataType.STRING;
  }

  // ========= 索引发现 =========
  async listIndices(config: Record<string, unknown>): Promise<{ tableName: string; tableType: string; comment?: string }[]> {
    const { Client } = await import('@elastic/elasticsearch');
    const nodes = (config.nodes as string).split(',').map(n => n.trim());
    const client = new Client({ nodes });
    try {
      const response = await client.cat.indices({ format: 'json' });
      return (response as any[]).map(idx => ({
        tableName: idx.index as string,
        tableType: idx.status === 'open' ? 'INDEX' : 'INDEX_CLOSED',
        comment: `docs: ${idx['docs.count']}, size: ${idx['store.size']}`,
      }));
    } finally {
      await client.close();
    }
  }

  // ========= 文档搜索 =========
  async searchDocuments(
    config: Record<string, unknown>,
    index: string,
    query: Record<string, unknown> = { match_all: {} },
    options: { from?: number; size?: number; sort?: any; _source?: string[] } = {}
  ): Promise<{ records: Record<string, unknown>[]; total: number }> {
    const { Client } = await import('@elastic/elasticsearch');
    const nodes = (config.nodes as string).split(',').map(n => n.trim());
    const client = new Client({ nodes });
    try {
      const response = await client.search({
        index,
        query,
        from: options.from,
        size: options.size,
        sort: options.sort,
        _source: options._source,
      });
      const hits = (response.hits?.hits as any[]) || [];
      const records = hits.map(h => ({ _id: h._id, _score: h._score, ...h._source }));
      const total = typeof response.hits?.total === 'number'
        ? response.hits.total
        : (response.hits?.total as any)?.value || 0;
      return { records, total };
    } finally {
      await client.close();
    }
  }

  // ========= 批量写入 =========
  async bulkWrite(
    config: Record<string, unknown>,
    index: string,
    documents: Array<{ id?: string; document: Record<string, unknown>; action?: 'index' | 'create' | 'update' | 'delete' }>
  ): Promise<{ success: number; failed: number; failures: any[] }> {
    const { Client } = await import('@elastic/elasticsearch');
    const nodes = (config.nodes as string).split(',').map(n => n.trim());
    const client = new Client({ nodes });
    try {
      const operations: any[] = [];
      documents.forEach(doc => {
        const action = doc.action || 'index';
        if (action === 'delete') {
          operations.push({ delete: { _index: index, _id: doc.id } });
        } else {
          const actionObj: any = { [action]: { _index: index } };
          if (doc.id) actionObj[action]._id = doc.id;
          operations.push(actionObj);
          if (action === 'update') {
            operations.push({ doc: doc.document });
          } else {
            operations.push(doc.document);
          }
        }
      });
      const response = await client.bulk({ operations });
      const items = (response.items as any[]) || [];
      const failures = items.filter((item: any) => {
        const action = Object.keys(item)[0];
        return item[action]?.error;
      });
      return {
        success: items.length - failures.length,
        failed: failures.length,
        failures,
      };
    } finally {
      await client.close();
    }
  }

  // ========= 索引管理 =========
  async createIndex(config: Record<string, unknown>, index: string, mappings: Record<string, unknown>, settings?: Record<string, unknown>): Promise<void> {
    const { Client } = await import('@elastic/elasticsearch');
    const nodes = (config.nodes as string).split(',').map(n => n.trim());
    const client = new Client({ nodes });
    try {
      await client.indices.create({ index, mappings: mappings as any, settings: settings as any });
    } finally {
      await client.close();
    }
  }

  async deleteIndex(config: Record<string, unknown>, index: string): Promise<void> {
    const { Client } = await import('@elastic/elasticsearch');
    const nodes = (config.nodes as string).split(',').map(n => n.trim());
    const client = new Client({ nodes });
    try {
      await client.indices.delete({ index });
    } finally {
      await client.close();
    }
  }

  async getMapping(config: Record<string, unknown>, index: string): Promise<Record<string, unknown>> {
    const { Client } = await import('@elastic/elasticsearch');
    const nodes = (config.nodes as string).split(',').map(n => n.trim());
    const client = new Client({ nodes });
    try {
      const response = await client.indices.getMapping({ index });
      return (response as any)[index]?.mappings || {};
    } finally {
      await client.close();
    }
  }
}
