/**
 * 连接器注册表
 *
 * 所有连接器通过 registerConnector 注册到这里
 * 前端通过 /api/connectors 接口获取可用连接器列表和配置表单定义
 *
 * 设计原则：
 * 1. 连接器按需加载，避免引入未使用的依赖
 * 2. 注册时只注册元数据，真正使用时才实例化
 * 3. 支持动态注册（未来可做连接器市场）
 */

import type { IConnector, ConnectorMetadata } from './types';

/** 连接器工厂函数类型 */
type ConnectorFactory = () => IConnector;

/** 注册条目 */
interface ConnectorEntry {
  metadata: ConnectorMetadata;
  factory: ConnectorFactory;
}

/** 注册表 */
const registry = new Map<string, ConnectorEntry>();

/**
 * 注册一个连接器
 */
export function registerConnector(type: string, metadata: ConnectorMetadata, factory: ConnectorFactory): void {
  if (registry.has(type)) {
    console.warn(`[ConnectorRegistry] 连接器 ${type} 已存在，将被覆盖`);
  }
  registry.set(type, { metadata, factory });
}

/**
 * 获取连接器元信息列表
 */
export function listConnectors(): ConnectorMetadata[] {
  return Array.from(registry.values()).map((e) => e.metadata);
}

/**
 * 按分类获取连接器
 */
export function listConnectorsByCategory(category: string): ConnectorMetadata[] {
  return Array.from(registry.values())
    .filter((e) => e.metadata.category === category)
    .map((e) => e.metadata);
}

/**
 * 获取连接器元信息
 */
export function getConnectorMetadata(type: string): ConnectorMetadata | undefined {
  return registry.get(type)?.metadata;
}

/**
 * 创建连接器实例
 */
export function createConnector(type: string): IConnector | undefined {
  const entry = registry.get(type);
  return entry ? entry.factory() : undefined;
}

/**
 * 创建作为源的连接器实例（支持读取数据）
 */
export function createSourceConnector(type: string): IConnector | undefined {
  const entry = registry.get(type);
  if (!entry) return undefined;
  const support = entry.metadata.typeSupport;
  if (support !== 'source' && support !== 'both') return undefined;
  return entry.factory();
}

/**
 * 创建作为目标的连接器实例（支持写入数据）
 */
export function createTargetConnector(type: string): IConnector | undefined {
  const entry = registry.get(type);
  if (!entry) return undefined;
  const support = entry.metadata.typeSupport;
  if (support !== 'target' && support !== 'both') return undefined;
  return entry.factory();
}

/** 检查连接器是否存在 */
export function hasConnector(type: string): boolean {
  return registry.has(type);
}

// ======================================================
// 注册内置连接器（启动时自动注册）
// ======================================================
import {
  MysqlConnector,
  PostgresConnector,
  OracleConnector,
  SqlServerConnector,
} from './relational';
import {
  RabbitMQConnector,
  KafkaConnector,
  RedisConnector,
  RocketMQConnector,
} from './messaging';
import { HttpApiConnector, WebhookConnector } from './api';
import { SftpConnector, FtpConnector, S3Connector, FileConnector } from './file';
import { DingTalkConnector, WeComConnector, FeishuConnector } from './saas';
import { MongoDBConnector, ElasticsearchConnector } from './nosql';
import { LdapConnector, ActiveDirectoryConnector } from './ldap';
import { ScimConnector } from './scim';
import { DamengConnector, KingbaseConnector } from './domestic-db';
import { YonyouU8Connector, FenxiangxiaokeConnector } from './enterprise-saas';

// 数据库类
registerConnector('mysql', new MysqlConnector().metadata, () => new MysqlConnector());
registerConnector('postgresql', new PostgresConnector().metadata, () => new PostgresConnector());
registerConnector('oracle', new OracleConnector().metadata, () => new OracleConnector());
registerConnector('sqlserver', new SqlServerConnector().metadata, () => new SqlServerConnector());

// 消息队列类
registerConnector('rabbitmq', new RabbitMQConnector().metadata, () => new RabbitMQConnector());
registerConnector('kafka', new KafkaConnector().metadata, () => new KafkaConnector());
registerConnector('rocketmq', new RocketMQConnector().metadata, () => new RocketMQConnector());
registerConnector('redis', new RedisConnector().metadata, () => new RedisConnector());

// API类
registerConnector('http_api', new HttpApiConnector().metadata, () => new HttpApiConnector());
registerConnector('webhook', new WebhookConnector().metadata, () => new WebhookConnector());

// 文件/存储类
registerConnector('sftp', new SftpConnector().metadata, () => new SftpConnector());
registerConnector('ftp', new FtpConnector().metadata, () => new FtpConnector());
registerConnector('s3', new S3Connector().metadata, () => new S3Connector());
registerConnector('csv_excel', new FileConnector().metadata, () => new FileConnector());

// SaaS应用类
registerConnector('dingtalk', new DingTalkConnector().metadata, () => new DingTalkConnector());
registerConnector('wecom', new WeComConnector().metadata, () => new WeComConnector());
registerConnector('feishu', new FeishuConnector().metadata, () => new FeishuConnector());

// NoSQL类
registerConnector('mongodb', new MongoDBConnector().metadata, () => new MongoDBConnector());
registerConnector('elasticsearch', new ElasticsearchConnector().metadata, () => new ElasticsearchConnector());

// 目录服务类
registerConnector('ldap', new LdapConnector().metadata, () => new LdapConnector());
registerConnector('active_directory', new ActiveDirectoryConnector().metadata, () => new ActiveDirectoryConnector());

// 身份协议类
registerConnector('scim2', new ScimConnector().metadata, () => new ScimConnector());

// 国产数据库
registerConnector('dameng', new DamengConnector().metadata, () => new DamengConnector());
registerConnector('kingbase', new KingbaseConnector().metadata, () => new KingbaseConnector());

// 企业级SaaS
registerConnector('yonyou_u8', new YonyouU8Connector().metadata, () => new YonyouU8Connector());
registerConnector('fenxiangxiaoke', new FenxiangxiaokeConnector().metadata, () => new FenxiangxiaokeConnector());

