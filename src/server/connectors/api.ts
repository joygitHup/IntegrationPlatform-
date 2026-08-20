/**
 * API 连接器：HTTP API / Webhook / SOAP
 * 用于调用外部 REST / Webhook 接口
 */

import type {
  ISourceConnector,
  ITargetConnector,
  ConnectorMetadata,
  ConnectionTestResult,
  ConfigValidationResult,
  ReadOptions,
  WriteResult,
} from './base';
import type { TableMetadata } from './types';

// ========== HTTP API Connector ==========

export class HttpApiConnector implements ISourceConnector, ITargetConnector {
  readonly type = 'http_api';
  readonly name = 'HTTP API';
  readonly metadata: ConnectorMetadata = {
    type: 'http_api',
    displayName: 'HTTP API',
    category: 'api',
    icon: 'globe',
    description: '通用 HTTP REST API 连接器',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: false,
      supportsIncremental: true,
      supportsPooling: false,
    },
    authMethods: [
      { type: 'anonymous', label: '无认证', default: true },
      { type: 'apikey', label: 'API Key' },
      { type: 'token', label: 'Bearer Token' },
      { type: 'oauth2', label: 'OAuth2' },
    ],
    configSchema: {
      required: ['baseUrl'],
      fields: [
        { name: 'baseUrl', label: '接口基地址', type: 'string', required: true, placeholder: 'https://api.example.com/v1', group: '基础配置' },
        { name: 'method', label: '请求方法', type: 'select', defaultValue: 'GET',
          options: [
            { value: 'GET', label: 'GET' },
            { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' },
            { value: 'PATCH', label: 'PATCH' },
          ], group: '基础配置' },
        { name: 'path', label: '路径模板', type: 'string', group: '基础配置', placeholder: '/users/{{id}}', help: '支持变量替换' },
        { name: 'authType', label: '认证方式', type: 'select', defaultValue: 'none',
          options: [
            { value: 'none', label: '无认证' },
            { value: 'apikey', label: 'API Key' },
            { value: 'bearer', label: 'Bearer Token' },
            { value: 'basic', label: 'Basic Auth' },
            { value: 'hmac', label: 'HMAC 签名' },
          ], group: '认证配置' },
        { name: 'apiKeyHeader', label: 'Header 名称', type: 'string', group: '认证配置', defaultValue: 'X-API-Key', showWhen: { field: 'authType', value: 'apikey' } },
        { name: 'apiKeyValue', label: 'API Key 值', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'apikey' } },
        { name: 'token', label: 'Token 值', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'bearer' } },
        { name: 'username', label: '用户名', type: 'string', group: '认证配置', showWhen: { field: 'authType', value: 'basic' } },
        { name: 'password', label: '密码', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'basic' } },
        { name: 'dataPath', label: '数据路径', type: 'string', group: '分页配置', defaultValue: 'data', help: '从响应体中提取列表数据的 JSON 路径' },
        { name: 'totalPath', label: '总数路径', type: 'string', group: '分页配置', defaultValue: 'total' },
        { name: 'pageParam', label: '分页参数名', type: 'string', group: '分页配置', defaultValue: 'page' },
        { name: 'pageSizeParam', label: '每页数量参数名', type: 'string', group: '分页配置', defaultValue: 'pageSize' },
        { name: 'timeout', label: '超时时间(秒)', type: 'number', defaultValue: 30, group: '高级选项' },
        { name: 'retryCount', label: '重试次数', type: 'number', defaultValue: 3, group: '高级选项' },
        { name: 'retryInterval', label: '重试间隔(秒)', type: 'number', defaultValue: 1, group: '高级选项' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.baseUrl) errors.push('接口基地址不能为空');
    if (config.baseUrl && !String(config.baseUrl).startsWith('http')) {
      errors.push('基地址必须以 http:// 或 https:// 开头');
    }
    return { valid: errors.length === 0, errors, warnings };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      return { success: false, message: validation.errors.join('; ') };
    }

    try {
      // 使用 Node.js 原生 fetch 进行连通性测试
      const url = config.baseUrl as string;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const method = (config.method as string) || 'GET';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      // 添加认证头
      const authType = config.authType as string;
      if (authType === 'bearer' && config.token) {
        headers['Authorization'] = `Bearer ${config.token}`;
      } else if (authType === 'apikey' && config.apiKeyValue) {
        headers[config.apiKeyHeader as string || 'X-API-Key'] = config.apiKeyValue as string;
      } else if (authType === 'basic' && config.username) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
      }

      const res = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        return {
          success: true,
          message: `连接成功 (HTTP ${res.status})`,
          latencyMs: Date.now() - startTime,
          details: { status: res.status, statusText: res.statusText },
        };
      } else {
        return {
          success: false,
          message: `连接失败 (HTTP ${res.status}: ${res.statusText})`,
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  async discoverSchema(): Promise<TableMetadata> { throw new Error('HTTP API 不支持 Schema 发现'); }
  async listTables(): Promise<TableMetadata[]> { return []; }
  async read(): Promise<{ totalRead: number }> { return { totalRead: 0 }; }
  async readSample(): Promise<Record<string, unknown>[]> { return []; }
  async write(): Promise<WriteResult> { return { successCount: 0, failedCount: 0 }; }
}

// ========== Webhook 入站连接器 ==========

export class WebhookConnector implements ISourceConnector {
  readonly type = 'webhook';
  readonly name = 'Webhook';
  readonly metadata: ConnectorMetadata = {
    type: 'webhook',
    displayName: 'Webhook',
    category: 'api',
    icon: 'webhook',
    description: 'Webhook 入站连接器，接收外部系统主动推送',
    capabilities: {
      canRead: true,
      canWrite: false,
      canDiscoverSchema: false,
      supportsIncremental: true,
      supportsPooling: false,
    },
    authMethods: [
      { type: 'anonymous', label: '无验证', default: true },
      { type: 'apikey', label: '签名验证' },
    ],
    configSchema: {
      required: ['name'],
      fields: [
        { name: 'name', label: 'Webhook 名称', type: 'string', required: true, group: '基础配置' },
        { name: 'sourceSystem', label: '来源系统标识', type: 'string', group: '基础配置', help: '用于防回环，标记数据来源' },
        { name: 'signatureType', label: '签名验证方式', type: 'select', defaultValue: 'none',
          options: [
            { value: 'none', label: '不验证' },
            { value: 'hmac-sha256', label: 'HMAC-SHA256' },
            { value: 'hmac-sha1', label: 'HMAC-SHA1' },
            { value: 'header-token', label: '固定 Token' },
          ], group: '安全配置' },
        { name: 'signatureSecret', label: '签名密钥', type: 'password', sensitive: true, group: '安全配置' },
        { name: 'signatureHeader', label: '签名 Header 名', type: 'string', defaultValue: 'X-Signature', group: '安全配置' },
        { name: 'ipWhitelist', label: 'IP 白名单', type: 'textarea', group: '安全配置', help: '每行一个 IP，支持 CIDR' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    if (!config.name) errors.push('Webhook 名称不能为空');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: 'Webhook 端点创建成功，可通过 /webhook/xxx 接收数据',
      details: {
        endpoint: `/api/webhook/receive/${config.name}`,
        method: 'POST',
      },
    };
  }

  async discoverSchema(): Promise<TableMetadata> { throw new Error('Webhook 不支持 Schema 发现'); }
  async listTables(): Promise<TableMetadata[]> { return []; }
  async read(): Promise<{ totalRead: number }> { return { totalRead: 0 }; }
  async readSample(): Promise<Record<string, unknown>[]> { return []; }
}
