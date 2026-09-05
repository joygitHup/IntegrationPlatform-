/**
 * SCIM 2.0 连接器
 * 跨系统身份同步标准协议 (RFC 7642 / 7643 / 7644)
 * 用于企业级身份管理系统的用户和组数据同步
 */

import type {
  IConnector,
  ConnectorMetadata,
  ConnectionTestResult,
  ConfigValidationResult,
} from './base';
import { StandardDataType } from './types';

// ========== SCIM 2.0 Connector ==========

export class ScimConnector implements IConnector {
  readonly type = 'scim2';
  readonly name = 'SCIM 2.0';
  readonly metadata: ConnectorMetadata = {
    type: 'scim2',
    displayName: 'SCIM 2.0',
    category: 'api',
    icon: 'user-cog',
    description: '跨系统身份管理标准协议 SCIM 2.0 (RFC 7643/7644)，支持用户和组的 CRUD 操作',
    typeSupport: 'both',
    version: '1.0.0',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: true,
      supportsFilter: true,
      supportsIncremental: true,
      supportsUpsert: true,
    },
    authMethods: [
      { type: 'token', label: 'Bearer Token', default: true },
      { type: 'password', label: '用户名/密码' },
      { type: 'apikey', label: 'API Key' },
      { type: 'oauth2', label: 'OAuth2' },
    ],
    configSchema: {
      required: ['baseUrl'],
      fields: [
        { name: 'baseUrl', label: 'SCIM 服务地址', type: 'string', required: true, placeholder: 'https://api.example.com/scim/v2', group: '基础配置', help: 'SCIM API 的根路径，包含版本号' },
        { name: 'authType', label: '认证方式', type: 'select', defaultValue: 'bearer',
          options: [
            { value: 'bearer', label: 'Bearer Token' },
            { value: 'basic', label: 'Basic Auth' },
            { value: 'apikey', label: 'API Key' },
            { value: 'none', label: '无认证' },
          ], group: '认证配置' },
        { name: 'token', label: 'Token 值', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'bearer' } },
        { name: 'username', label: '用户名', type: 'string', group: '认证配置', showWhen: { field: 'authType', value: 'basic' } },
        { name: 'password', label: '密码', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'basic' } },
        { name: 'apiKeyHeader', label: 'Header 名称', type: 'string', defaultValue: 'Authorization', group: '认证配置', showWhen: { field: 'authType', value: 'apikey' } },
        { name: 'apiKeyValue', label: 'API Key 值', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'apikey' } },
        { name: 'userEndpoint', label: '用户端点', type: 'string', defaultValue: '/Users', group: '端点配置', help: '用户资源路径，默认为 /Users' },
        { name: 'groupEndpoint', label: '组端点', type: 'string', defaultValue: '/Groups', group: '端点配置', help: '组资源路径，默认为 /Groups' },
        { name: 'timeout', label: '请求超时(秒)', type: 'number', defaultValue: 30, group: '高级选项' },
        { name: 'defaultCount', label: '默认分页大小', type: 'number', defaultValue: 100, group: '高级选项' },
        { name: 'retries', label: '重试次数', type: 'number', defaultValue: 2, group: '高级选项' },
        { name: 'validateSsl', label: '验证 SSL 证书', type: 'boolean', defaultValue: true, group: '安全选项' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.baseUrl) errors.push('SCIM 服务地址不能为空');
    if (config.baseUrl && !String(config.baseUrl).startsWith('http')) {
      errors.push('服务地址必须以 http:// 或 https:// 开头');
    }
    if (config.authType === 'bearer' && !config.token) errors.push('Bearer Token 不能为空');
    if (config.authType === 'basic') {
      if (!config.username) errors.push('用户名不能为空');
      if (!config.password) errors.push('密码不能为空');
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
      // 通过查询 ServiceProviderConfig 或 用户端点测试连通性
      const headers = this.buildHeaders(config);
      const baseUrl = (config.baseUrl as string).replace(/\/$/, '');
      const count = 1;

      const response = await fetch(`${baseUrl}/Users?count=${count}`, {
        method: 'GET',
        headers,
      });

      const latency = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          message: 'SCIM 连接成功',
          latencyMs: latency,
          serverVersion: 'SCIM 2.0',
          details: {
            totalResults: data.totalResults,
            itemsPerPage: data.itemsPerPage,
            supportedSchemas: data.schemas || [],
          },
        };
      }

      return {
        success: false,
        message: `连接失败: HTTP ${response.status} ${response.statusText}`,
        latencyMs: latency,
        details: { statusCode: response.status },
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
  mapToStandardType(scimAttribute: string): StandardDataType {
    const map: Record<string, StandardDataType> = {
      string: StandardDataType.STRING,
      boolean: StandardDataType.BOOLEAN,
      decimal: StandardDataType.DECIMAL,
      integer: StandardDataType.INTEGER,
      dateTime: StandardDataType.DATETIME,
      binary: StandardDataType.BINARY,
      reference: StandardDataType.STRING,
      complex: StandardDataType.JSON,
    };
    return map[scimAttribute] || StandardDataType.STRING;
  }

  // ========= HTTP 工具 =========
  private buildHeaders(config: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/scim+json',
      'Accept': 'application/scim+json',
    };

    const authType = config.authType || 'bearer';
    if (authType === 'bearer' && config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
    } else if (authType === 'basic' && config.username && config.password) {
      const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    } else if (authType === 'apikey' && config.apiKeyHeader && config.apiKeyValue) {
      headers[config.apiKeyHeader as string] = config.apiKeyValue as string;
    }

    return headers;
  }

  private async scimRequest(
    config: Record<string, unknown>,
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<any> {
    const baseUrl = (config.baseUrl as string).replace(/\/$/, '');
    const url = `${baseUrl}${path}`;
    const headers = this.buildHeaders(config);
    const timeout = ((config.timeout as number) || 30) * 1000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let data: any;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        const err = new Error(data.detail || `SCIM 请求失败: HTTP ${response.status}`);
        (err as any).status = response.status;
        (err as any).scimError = data;
        throw err;
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ========= 用户操作 =========
  async listUsers(config: Record<string, unknown>, options: {
    startIndex?: number;
    count?: number;
    filter?: string;
    attributes?: string[];
    excludedAttributes?: string[];
  } = {}): Promise<{
    totalResults: number;
    itemsPerPage: number;
    startIndex: number;
    Resources: Record<string, unknown>[];
  }> {
    const params = new URLSearchParams();
    if (options.startIndex) params.set('startIndex', String(options.startIndex));
    if (options.count) params.set('count', String(options.count));
    if (options.filter) params.set('filter', options.filter);
    if (options.attributes) params.set('attributes', options.attributes.join(','));
    if (options.excludedAttributes) params.set('excludedAttributes', options.excludedAttributes.join(','));

    const userEndpoint = (config.userEndpoint as string) || '/Users';
    const path = params.toString() ? `${userEndpoint}?${params.toString()}` : userEndpoint;
    return this.scimRequest(config, 'GET', path);
  }

  async getUser(config: Record<string, unknown>, userId: string, attributes?: string[]): Promise<Record<string, unknown>> {
    const userEndpoint = (config.userEndpoint as string) || '/Users';
    const params = attributes ? `?attributes=${attributes.join(',')}` : '';
    return this.scimRequest(config, 'GET', `${userEndpoint}/${encodeURIComponent(userId)}${params}`);
  }

  async createUser(config: Record<string, unknown>, user: Record<string, unknown>): Promise<Record<string, unknown>> {
    const userEndpoint = (config.userEndpoint as string) || '/Users';
    const body = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      ...user,
    };
    return this.scimRequest(config, 'POST', userEndpoint, body);
  }

  async updateUser(config: Record<string, unknown>, userId: string, user: Record<string, unknown>): Promise<Record<string, unknown>> {
    const userEndpoint = (config.userEndpoint as string) || '/Users';
    return this.scimRequest(config, 'PUT', `${userEndpoint}/${encodeURIComponent(userId)}`, user);
  }

  async patchUser(config: Record<string, unknown>, userId: string, operations: Array<{
    op: 'add' | 'remove' | 'replace';
    path?: string;
    value?: any;
  }>): Promise<Record<string, unknown>> {
    const userEndpoint = (config.userEndpoint as string) || '/Users';
    const body = {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: operations,
    };
    return this.scimRequest(config, 'PATCH', `${userEndpoint}/${encodeURIComponent(userId)}`, body);
  }

  async deleteUser(config: Record<string, unknown>, userId: string): Promise<void> {
    const userEndpoint = (config.userEndpoint as string) || '/Users';
    await this.scimRequest(config, 'DELETE', `${userEndpoint}/${encodeURIComponent(userId)}`);
  }

  // ========= 组操作 =========
  async listGroups(config: Record<string, unknown>, options: {
    startIndex?: number;
    count?: number;
    filter?: string;
    attributes?: string[];
  } = {}): Promise<{
    totalResults: number;
    itemsPerPage: number;
    startIndex: number;
    Resources: Record<string, unknown>[];
  }> {
    const params = new URLSearchParams();
    if (options.startIndex !== undefined) params.set('startIndex', String(options.startIndex));
    if (options.count !== undefined) params.set('count', String(options.count));
    if (options.filter) params.set('filter', options.filter);
    if (options.attributes) params.set('attributes', options.attributes.join(','));

    const groupEndpoint = (config.groupEndpoint as string) || '/Groups';
    const path = params.toString() ? `${groupEndpoint}?${params.toString()}` : groupEndpoint;
    return this.scimRequest(config, 'GET', path);
  }

  async getGroup(config: Record<string, unknown>, groupId: string): Promise<Record<string, unknown>> {
    const groupEndpoint = (config.groupEndpoint as string) || '/Groups';
    return this.scimRequest(config, 'GET', `${groupEndpoint}/${encodeURIComponent(groupId)}`);
  }

  async createGroup(config: Record<string, unknown>, group: Record<string, unknown>): Promise<Record<string, unknown>> {
    const groupEndpoint = (config.groupEndpoint as string) || '/Groups';
    const body = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      ...group,
    };
    return this.scimRequest(config, 'POST', groupEndpoint, body);
  }

  async updateGroup(config: Record<string, unknown>, groupId: string, group: Record<string, unknown>): Promise<Record<string, unknown>> {
    const groupEndpoint = (config.groupEndpoint as string) || '/Groups';
    return this.scimRequest(config, 'PUT', `${groupEndpoint}/${encodeURIComponent(groupId)}`, group);
  }

  async deleteGroup(config: Record<string, unknown>, groupId: string): Promise<void> {
    const groupEndpoint = (config.groupEndpoint as string) || '/Groups';
    await this.scimRequest(config, 'DELETE', `${groupEndpoint}/${encodeURIComponent(groupId)}`);
  }

  // ========= Bulk 批量操作 =========
  async bulkOperations(config: Record<string, unknown>, operations: Array<{
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    bulkId?: string;
    data?: Record<string, unknown>;
  }>, failOnErrors?: number): Promise<any> {
    const body = {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
      failOnErrors: failOnErrors ?? 0,
      Operations: operations.map(op => ({
        method: op.method,
        path: op.path,
        bulkId: op.bulkId,
        data: op.data,
      })),
    };
    return this.scimRequest(config, 'POST', '/Bulk', body);
  }

  // ========= Service Provider Config =========
  async getServiceProviderConfig(config: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.scimRequest(config, 'GET', '/ServiceProviderConfig');
  }

  async getResourceTypes(config: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const data = await this.scimRequest(config, 'GET', '/ResourceTypes');
    return data.Resources || [];
  }

  async getSchemas(config: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const data = await this.scimRequest(config, 'GET', '/Schemas');
    return data.Resources || [];
  }
}
