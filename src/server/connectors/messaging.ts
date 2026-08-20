import { IConnector, ConnectorMetadata, StandardDataType } from './types';

/**
 * RabbitMQ 连接器
 * 生产环境需安装 amqplib: pnpm add amqplib
 */
export class RabbitMQConnector implements IConnector {
  readonly type = 'rabbitmq';
  readonly name = 'RabbitMQ';
  readonly metadata: ConnectorMetadata = {
    type: 'rabbitmq',
    name: 'RabbitMQ',
    category: 'messaging',
    description: 'RabbitMQ 消息队列连接器，支持消息生产和消费',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 5672 },
        { name: 'user', label: '用户名', type: 'string', required: true, defaultValue: 'guest' },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true, defaultValue: 'guest' },
        { name: 'vhost', label: 'Virtual Host', type: 'string', defaultValue: '/' },
        { name: 'exchange', label: '交换机名', type: 'string', required: true, description: '消息发送的目标交换机' },
        { name: 'queue', label: '队列名', type: 'string', description: '消费时指定队列' },
        { name: 'routingKey', label: '路由键', type: 'string', description: '发布时使用的路由键' },
        { name: 'exchangeType', label: '交换机类型', type: 'select', defaultValue: 'direct',
          options: [
            { label: 'Direct', value: 'direct' },
            { label: 'Topic', value: 'topic' },
            { label: 'Fanout', value: 'fanout' },
            { label: 'Headers', value: 'headers' },
          ] },
        { name: 'durable', label: '持久化', type: 'boolean', defaultValue: true },
        { name: 'prefetch', label: '预取数', type: 'number', defaultValue: 1 },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 10 },
        { name: 'heartbeat', label: '心跳(秒)', type: 'number', defaultValue: 60 },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.host) errors.push('主机地址不能为空');
    if (!config.port) errors.push('端口不能为空');
    if (!config.exchange) errors.push('交换机名不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      // 存根实现：只做TCP连通性测试
      const net = await import('net');
      await new Promise<void>((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout(config.connectTimeout * 1000 || 10000);
        sock.on('connect', () => { sock.destroy(); resolve(); });
        sock.on('error', reject);
        sock.on('timeout', () => { sock.destroy(); reject(new Error('连接超时')); });
        sock.connect(config.port, config.host);
      });
      return { success: true, latencyMs: Date.now() - start, message: 'TCP连通正常（生产环境需安装amqplib进行协议级测试）' };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}

/**
 * Kafka 连接器
 * 生产环境需安装 kafkajs: pnpm add kafkajs
 */
export class KafkaConnector implements IConnector {
  readonly type = 'kafka';
  readonly name = 'Kafka';
  readonly metadata: ConnectorMetadata = {
    type: 'kafka',
    name: 'Kafka',
    category: 'messaging',
    description: 'Apache Kafka 消息队列连接器，支持高吞吐消息生产和消费',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'brokers', label: 'Broker列表', type: 'textarea', required: true, placeholder: 'kafka1:9092,kafka2:9092,kafka3:9092', description: '逗号分隔的broker地址' },
        { name: 'clientId', label: 'Client ID', type: 'string', defaultValue: 'integration-platform' },
        { name: 'topic', label: 'Topic', type: 'string', required: true, description: '生产或消费的主题' },
        { name: 'groupId', label: '消费者组', type: 'string', description: '消费时使用的消费者组ID' },
        { name: 'saslMechanism', label: 'SASL机制', type: 'select', defaultValue: 'plain',
          options: [
            { label: 'PLAIN', value: 'plain' },
            { label: 'SCRAM-SHA-256', value: 'scram-sha-256' },
            { label: 'SCRAM-SHA-512', value: 'scram-sha-512' },
            { label: '不使用', value: 'none' },
          ] },
        { name: 'username', label: '用户名', type: 'string', description: 'SASL认证时使用' },
        { name: 'password', label: '密码', type: 'password', sensitive: true, description: 'SASL认证时使用' },
        { name: 'ssl', label: '启用SSL', type: 'boolean', defaultValue: false },
        { name: 'acks', label: 'ACK确认级别', type: 'select', defaultValue: 'all',
          options: [
            { label: '0 - 不等待确认', value: '0' },
            { label: '1 - Leader确认', value: '1' },
            { label: 'all - 全部副本确认', value: 'all' },
          ] },
        { name: 'retries', label: '重试次数', type: 'number', defaultValue: 3 },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.brokers) errors.push('Broker列表不能为空');
    if (!config.topic) errors.push('Topic不能为空');
    if (config.saslMechanism && config.saslMechanism !== 'none') {
      if (!config.username) errors.push('SASL认证需要用户名');
      if (!config.password) errors.push('SASL认证需要密码');
    }
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      const brokers = String(config.brokers).split(',').map(b => b.trim());
      const net = await import('net');
      let lastError: Error | null = null;
      for (const broker of brokers) {
        const [host, portStr] = broker.split(':');
        const port = parseInt(portStr || '9092', 10);
        try {
          await new Promise<void>((resolve, reject) => {
            const sock = new net.Socket();
            sock.setTimeout(5000);
            sock.on('connect', () => { sock.destroy(); resolve(); });
            sock.on('error', reject);
            sock.on('timeout', () => { sock.destroy(); reject(new Error('超时')); });
            sock.connect(port, host);
          });
          return { success: true, latencyMs: Date.now() - start, message: `Broker ${broker} TCP连通正常（生产环境需安装kafkajs进行协议级测试）` };
        } catch (e: any) {
          lastError = e;
        }
      }
      return { success: false, latencyMs: Date.now() - start, message: lastError?.message || '所有Broker均无法连接' };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}

/**
 * RocketMQ 连接器
 * 生产环境需安装 @apache-rocketmq/broker 等 SDK
 */
export class RocketMQConnector implements IConnector {
  readonly type = 'rocketmq';
  readonly name = 'RocketMQ';
  readonly metadata: ConnectorMetadata = {
    type: 'rocketmq',
    name: 'RocketMQ',
    category: 'messaging',
    description: 'Apache RocketMQ 消息队列连接器，金融级可靠性，支持事务消息',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'nameServer', label: 'NameServer地址', type: 'string', required: true, placeholder: 'namesrv1:9876;namesrv2:9876' },
        { name: 'groupId', label: 'Group ID', type: 'string', required: true, description: '生产者或消费者组' },
        { name: 'topic', label: 'Topic', type: 'string', required: true },
        { name: 'tag', label: 'Tag', type: 'string', description: '消息标签，用于过滤' },
        { name: 'accessKey', label: 'AccessKey', type: 'string', description: '阿里云RocketMQ需要' },
        { name: 'secretKey', label: 'SecretKey', type: 'password', sensitive: true, description: '阿里云RocketMQ需要' },
        { name: 'instanceId', label: '实例ID', type: 'string', description: '企业版实例需要' },
        { name: 'sendTimeout', label: '发送超时(毫秒)', type: 'number', defaultValue: 3000 },
        { name: 'consumeThreadNums', label: '消费线程数', type: 'number', defaultValue: 20 },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.nameServer) errors.push('NameServer地址不能为空');
    if (!config.groupId) errors.push('Group ID不能为空');
    if (!config.topic) errors.push('Topic不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      const namesrvs = String(config.nameServer).split(/[;,]/).map(n => n.trim());
      const net = await import('net');
      for (const ns of namesrvs) {
        const [host, portStr] = ns.split(':');
        const port = parseInt(portStr || '9876', 10);
        try {
          await new Promise<void>((resolve, reject) => {
            const sock = new net.Socket();
            sock.setTimeout(5000);
            sock.on('connect', () => { sock.destroy(); resolve(); });
            sock.on('error', reject);
            sock.on('timeout', () => { sock.destroy(); reject(new Error('超时')); });
            sock.connect(port, host);
          });
          return { success: true, latencyMs: Date.now() - start, message: `NameServer ${ns} TCP连通正常（生产环境需安装RocketMQ SDK进行协议级测试）` };
        } catch {}
      }
      return { success: false, latencyMs: Date.now() - start, message: '所有NameServer均无法连接' };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}

/**
 * Redis 连接器 - 用于消息/缓存场景
 */
export class RedisConnector implements IConnector {
  readonly type = 'redis';
  readonly name = 'Redis';
  readonly metadata: ConnectorMetadata = {
    type: 'redis',
    name: 'Redis',
    category: 'messaging',
    description: 'Redis 缓存/消息队列连接器，支持 Pub/Sub 和 List 队列模式',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'localhost' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 6379 },
        { name: 'password', label: '密码', type: 'password', sensitive: true, description: '无密码可不填' },
        { name: 'db', label: '数据库编号', type: 'number', defaultValue: 0 },
        { name: 'mode', label: '部署模式', type: 'select', defaultValue: 'standalone',
          options: [
            { label: '单机', value: 'standalone' },
            { label: '哨兵(Sentinel)', value: 'sentinel' },
            { label: '集群(Cluster)', value: 'cluster' },
          ] },
        { name: 'keyPattern', label: 'Key前缀/模式', type: 'string', description: '消息队列使用的Key前缀' },
        { name: 'mode_detail', label: '消息模式', type: 'select', defaultValue: 'list',
          options: [
            { label: 'List队列', value: 'list' },
            { label: 'Pub/Sub', value: 'pubsub' },
            { label: 'Stream', value: 'stream' },
            { label: '缓存读写', value: 'cache' },
          ] },
        { name: 'connectTimeout', label: '连接超时(毫秒)', type: 'number', defaultValue: 10000 },
        { name: 'lazyConnect', label: '惰性连接', type: 'boolean', defaultValue: false },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.host) errors.push('主机地址不能为空');
    if (!config.port) errors.push('端口不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      const net = await import('net');
      const result = await new Promise<{ ok: boolean; info?: string }>((resolve) => {
        const sock = new net.Socket();
        sock.setTimeout(config.connectTimeout || 10000);
        sock.on('data', (data: Buffer) => {
          const resp = data.toString();
          sock.destroy();
          resolve({ ok: resp.startsWith('+PONG') || resp.includes('PONG'), info: resp.substring(0, 100) });
        });
        sock.on('connect', () => {
          const cmd = config.password ? `AUTH ${config.password}\r\nPING\r\n` : 'PING\r\n';
          sock.write(cmd);
        });
        sock.on('error', (e) => { sock.destroy(); resolve({ ok: false, info: e.message }); });
        sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, info: '连接超时' }); });
        sock.connect(config.port, config.host);
      });
      return { success: result.ok, latencyMs: Date.now() - start, message: result.ok ? 'Redis连接正常' : result.info };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}
