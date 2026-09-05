/**
 * 企业级 SaaS 连接器
 * - 用友 U8 ERP：企业管理软件（财务、供应链、生产制造）
 * - 纷享销客 CRM：客户关系管理系统
 * 均通过 HTTP API 进行数据同步
 */

import type {
  IConnector,
  ConnectorMetadata,
  ConnectionTestResult,
  ConfigValidationResult,
} from './base';
import { StandardDataType } from './types';

// ========== 用友 U8 ERP 连接器 ==========
// 用友 U8 是国内使用广泛的 ERP 系统，覆盖财务、供应链、生产制造等领域
// 支持通过 U8 OpenAPI / EAI 接口进行数据交互

export class YonyouU8Connector implements IConnector {
  readonly type = 'yonyou_u8';
  readonly name = '用友 U8 ERP';
  readonly metadata: ConnectorMetadata = {
    type: 'yonyou_u8',
    displayName: '用友 U8 ERP',
    category: 'saas',
    icon: 'building',
    description: '用友 U8 企业管理软件连接器，支持财务、供应链、生产制造等模块的数据同步',
    typeSupport: 'both',
    version: '1.0.0',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: false,
      supportsIncremental: true,
      supportsFilter: true,
    },
    authMethods: [
      { type: 'token', label: 'Token 认证', default: true },
      { type: 'password', label: '用户名/密码' },
    ],
    configSchema: {
      required: ['baseUrl'],
      fields: [
        { name: 'baseUrl', label: 'U8 API 地址', type: 'string', required: true, placeholder: 'http://u8.example.com/U8API', group: '基础配置', help: '用友 U8 OpenAPI / EAI 接口地址' },
        { name: 'authType', label: '认证方式', type: 'select', defaultValue: 'token',
          options: [
            { value: 'token', label: 'Token 认证' },
            { value: 'account', label: '账号密码' },
          ], group: '认证配置' },
        { name: 'token', label: 'API Token', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'token' } },
        { name: 'username', label: '用户名', type: 'string', group: '认证配置', showWhen: { field: 'authType', value: 'account' } },
        { name: 'password', label: '密码', type: 'password', sensitive: true, group: '认证配置', showWhen: { field: 'authType', value: 'account' } },
        { name: 'orgCode', label: '组织编码', type: 'string', group: '基础配置', help: '企业/组织编码，多组织环境下必填' },
        { name: 'accountCode', label: '账套编码', type: 'string', group: '基础配置', defaultValue: '999' },
        { name: 'year', label: '年度', type: 'string', group: '基础配置', help: '会计年度，默认为当前年度' },
        { name: 'timeout', label: '请求超时(秒)', type: 'number', defaultValue: 30, group: '高级选项' },
        { name: 'retryCount', label: '重试次数', type: 'number', defaultValue: 3, group: '高级选项' },
        { name: 'retryInterval', label: '重试间隔(秒)', type: 'number', defaultValue: 2, group: '高级选项' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.baseUrl) errors.push('API 地址不能为空');
    if (config.baseUrl && !String(config.baseUrl).startsWith('http')) {
      errors.push('API 地址必须以 http:// 或 https:// 开头');
    }
    if (config.authType === 'token' && !config.token) {
      errors.push('Token 不能为空');
    }
    if (config.authType === 'account') {
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
      // 通过获取账套信息或简单接口测试连通性
      const baseUrl = (config.baseUrl as string).replace(/\/$/, '');
      const headers = this.buildHeaders(config);

      // 尝试调用一个简单的接口（如获取系统信息或账套列表）
      const response = await fetch(`${baseUrl}/api/Login/GetSystemInfo`, {
        method: 'GET',
        headers,
      });

      const latency = Date.now() - startTime;
      const data = await response.json().catch(() => ({}));

      if (response.ok && !data?.errcode) {
        return {
          success: true,
          message: '用友 U8 连接成功',
          latencyMs: latency,
          details: { accountCode: config.accountCode, orgCode: config.orgCode },
        };
      }

      return {
        success: false,
        message: `连接失败: ${data?.message || data?.errmsg || `HTTP ${response.status}`}`,
        latencyMs: latency,
        details: { statusCode: response.status, errorCode: data?.errcode },
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

  // ========= HTTP 工具 =========
  private buildHeaders(config: Record<string, unknown>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (config.authType === 'token' && config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
    }
    if (config.orgCode) {
      headers['X-Org-Code'] = config.orgCode as string;
    }
    if (config.accountCode) {
      headers['X-Account-Code'] = config.accountCode as string;
    }

    return headers;
  }

  private async request(
    config: Record<string, unknown>,
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<any> {
    const baseUrl = (config.baseUrl as string).replace(/\/$/, '');
    const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
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

      const data = await response.json().catch(() => ({ raw: 'non-json response' }));

      if (!response.ok) {
        throw new Error(`U8 API 请求失败: HTTP ${response.status} - ${data?.message || data?.errmsg || ''}`);
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ========= 通用业务接口 =========

  // 客户档案
  async listCustomers(config: Record<string, unknown>, options?: {
    pageIndex?: number; pageSize?: number; beginDate?: string; endDate?: string; keyword?: string;
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const params = new URLSearchParams();
    if (options?.pageIndex !== undefined) params.set('pageIndex', String(options.pageIndex));
    if (options?.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
    if (options?.beginDate) params.set('beginDate', options.beginDate);
    if (options?.endDate) params.set('endDate', options.endDate);
    if (options?.keyword) params.set('keyword', options.keyword);

    const data = await this.request(config, 'GET', `/api/Customer/List?${params.toString()}`);
    return { total: data?.total || 0, list: data?.list || data?.data || [] };
  }

  // 供应商档案
  async listVendors(config: Record<string, unknown>, options?: {
    pageIndex?: number; pageSize?: number; keyword?: string;
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const params = new URLSearchParams();
    if (options?.pageIndex !== undefined) params.set('pageIndex', String(options.pageIndex));
    if (options?.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
    if (options?.keyword) params.set('keyword', options.keyword);

    const data = await this.request(config, 'GET', `/api/Vendor/List?${params.toString()}`);
    return { total: data?.total || 0, list: data?.list || data?.data || [] };
  }

  // 存货档案
  async listInventory(config: Record<string, unknown>, options?: {
    pageIndex?: number; pageSize?: number; keyword?: string; classCode?: string;
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const params = new URLSearchParams();
    if (options?.pageIndex !== undefined) params.set('pageIndex', String(options.pageIndex));
    if (options?.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
    if (options?.keyword) params.set('keyword', options.keyword);
    if (options?.classCode) params.set('classCode', options.classCode);

    const data = await this.request(config, 'GET', `/api/Inventory/List?${params.toString()}`);
    return { total: data?.total || 0, list: data?.list || data?.data || [] };
  }

  // 部门档案
  async listDepartments(config: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const data = await this.request(config, 'GET', '/api/Department/List');
    return data?.list || data?.data || [];
  }

  // 人员档案
  async listEmployees(config: Record<string, unknown>, options?: {
    pageIndex?: number; pageSize?: number; department?: string; keyword?: string;
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const params = new URLSearchParams();
    if (options?.pageIndex !== undefined) params.set('pageIndex', String(options.pageIndex));
    if (options?.pageSize !== undefined) params.set('pageSize', String(options.pageSize));
    if (options?.department) params.set('department', options.department);
    if (options?.keyword) params.set('keyword', options.keyword);

    const data = await this.request(config, 'GET', `/api/Employee/List?${params.toString()}`);
    return { total: data?.total || 0, list: data?.list || data?.data || [] };
  }

  // 创建客户
  async createCustomer(config: Record<string, unknown>, customer: Record<string, unknown>): Promise<any> {
    return this.request(config, 'POST', '/api/Customer/Create', customer);
  }

  // 更新客户
  async updateCustomer(config: Record<string, unknown>, customer: Record<string, unknown>): Promise<any> {
    return this.request(config, 'POST', '/api/Customer/Update', customer);
  }
}

// ========== 纷享销客 CRM 连接器 ==========
// 纷享销客是国内主流的 CRM SaaS 服务
// 通过 OpenAPI 进行客户、商机、联系人等数据的同步

export class FenxiangxiaokeConnector implements IConnector {
  readonly type = 'fenxiangxiaoke';
  readonly name = '纷享销客 CRM';
  readonly metadata: ConnectorMetadata = {
    type: 'fenxiangxiaoke',
    displayName: '纷享销客 CRM',
    category: 'saas',
    icon: 'users',
    description: '纷享销客 CRM 连接器，支持客户、联系人、商机、线索等业务对象的数据同步',
    typeSupport: 'both',
    version: '1.0.0',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: true,
      supportsIncremental: true,
      supportsFilter: true,
      supportsUpsert: true,
    },
    authMethods: [
      { type: 'oauth2', label: 'OAuth 2.0', default: true },
      { type: 'apikey', label: 'API Key' },
    ],
    configSchema: {
      required: ['baseUrl', 'appId'],
      fields: [
        { name: 'baseUrl', label: 'API 地址', type: 'string', required: true, placeholder: 'https://open.fxiaoke.com', group: '基础配置', defaultValue: 'https://open.fxiaoke.com' },
        { name: 'appId', label: '应用 App ID', type: 'string', required: true, placeholder: 'FSCxxxxxx', group: '认证配置', help: '纷享销客开放平台应用 ID' },
        { name: 'appSecret', label: '应用 App Secret', type: 'password', required: true, sensitive: true, group: '认证配置' },
        { name: 'permanentCode', label: '永久授权码', type: 'password', sensitive: true, group: '认证配置', help: '企业安装应用后的永久授权码' },
        { name: 'corpId', label: '企业 ID', type: 'string', group: '认证配置', help: '纷享销客企业 ID' },
        { name: 'timeout', label: '请求超时(秒)', type: 'number', defaultValue: 30, group: '高级选项' },
        { name: 'retryCount', label: '重试次数', type: 'number', defaultValue: 3, group: '高级选项' },
        { name: 'retryInterval', label: '重试间隔(秒)', type: 'number', defaultValue: 1, group: '高级选项' },
      ],
    },
  };

  // access token 缓存
  private tokenCache: { token: string; expireAt: number } | null = null;

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.baseUrl) errors.push('API 地址不能为空');
    if (!config.appId) errors.push('App ID 不能为空');
    if (!config.appSecret) errors.push('App Secret 不能为空');
    if (!config.permanentCode && !config.corpId) {
      warnings.push('永久授权码和企业 ID 至少提供一个');
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
      // 通过获取 access_token 测试连通性
      const token = await this.getAccessToken(config);
      const latency = Date.now() - startTime;
      return {
        success: true,
        message: '纷享销客连接成功',
        latencyMs: latency,
        details: { hasToken: !!token, corpId: config.corpId },
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

  // ========= Access Token =========
  private async getAccessToken(config: Record<string, unknown>): Promise<string> {
    const now = Date.now();
    // 缓存有效，且距离过期还有 5 分钟以上
    if (this.tokenCache && this.tokenCache.expireAt - now > 300000) {
      return this.tokenCache.token;
    }

    const baseUrl = (config.baseUrl as string).replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/cgi/corpAccessToken/get/V2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: config.appId,
        appSecret: config.appSecret,
        permanentCode: config.permanentCode,
      }),
    });

    const data = await response.json();
    if (data.errcode !== 0) {
      throw new Error(`获取 access_token 失败: ${data.errmsg}`);
    }

    const token = data.access_token || data.corpAccessToken;
    const expiresIn = data.expires_in || 7200;
    this.tokenCache = {
      token,
      expireAt: now + expiresIn * 1000,
    };

    return token;
  }

  // ========= HTTP 工具 =========
  private async request(
    config: Record<string, unknown>,
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<any> {
    const baseUrl = (config.baseUrl as string).replace(/\/$/, '');
    const token = await this.getAccessToken(config);
    const url = `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const timeout = ((config.timeout as number) || 30) * 1000;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'token': token,
      };

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json();

      if (data.errcode !== undefined && data.errcode !== 0) {
        throw new Error(`纷享销客 API 错误: ${data.errcode} - ${data.errmsg}`);
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ========= CRM 对象操作 =========

  // 客户列表
  async listAccounts(config: Record<string, unknown>, options?: {
    offset?: number; limit?: number; filters?: Record<string, unknown>[];
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const data = await this.request(config, 'POST', '/cgi/crm/account/list', {
      offset: options?.offset || 0,
      limit: options?.limit || 100,
      filters: options?.filters || [],
    });
    return { total: data.total || 0, list: data.accountList || data.list || [] };
  }

  // 联系人列表
  async listContacts(config: Record<string, unknown>, options?: {
    offset?: number; limit?: number; filters?: Record<string, unknown>[];
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const data = await this.request(config, 'POST', '/cgi/crm/contact/list', {
      offset: options?.offset || 0,
      limit: options?.limit || 100,
      filters: options?.filters || [],
    });
    return { total: data.total || 0, list: data.contactList || data.list || [] };
  }

  // 商机列表
  async listOpportunities(config: Record<string, unknown>, options?: {
    offset?: number; limit?: number; filters?: Record<string, unknown>[];
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const data = await this.request(config, 'POST', '/cgi/crm/opportunity/list', {
      offset: options?.offset || 0,
      limit: options?.limit || 100,
      filters: options?.filters || [],
    });
    return { total: data.total || 0, list: data.opportunityList || data.list || [] };
  }

  // 线索列表
  async listLeads(config: Record<string, unknown>, options?: {
    offset?: number; limit?: number; filters?: Record<string, unknown>[];
  }): Promise<{ total: number; list: Record<string, unknown>[] }> {
    const data = await this.request(config, 'POST', '/cgi/crm/lead/list', {
      offset: options?.offset || 0,
      limit: options?.limit || 100,
      filters: options?.filters || [],
    });
    return { total: data.total || 0, list: data.leadList || data.list || [] };
  }

  // 创建客户
  async createAccount(config: Record<string, unknown>, data: Record<string, unknown>): Promise<string> {
    const result = await this.request(config, 'POST', '/cgi/crm/account/create', data);
    return result.data?.id || result.id;
  }

  // 更新客户
  async updateAccount(config: Record<string, unknown>, id: string, data: Record<string, unknown>): Promise<void> {
    await this.request(config, 'POST', '/cgi/crm/account/update', { id, ...data });
  }

  // 创建联系人
  async createContact(config: Record<string, unknown>, data: Record<string, unknown>): Promise<string> {
    const result = await this.request(config, 'POST', '/cgi/crm/contact/create', data);
    return result.data?.id || result.id;
  }

  // 更新联系人
  async updateContact(config: Record<string, unknown>, id: string, data: Record<string, unknown>): Promise<void> {
    await this.request(config, 'POST', '/cgi/crm/contact/update', { id, ...data });
  }

  // 获取对象字段描述
  async describeObject(config: Record<string, unknown>, objectApiName: string): Promise<Record<string, unknown>[]> {
    const data = await this.request(config, 'POST', '/cgi/crm/field/list', {
      objectApiName,
    });
    return data.fieldList || data.list || [];
  }

  // 类型映射
  mapToStandardType(fxkType: string): StandardDataType {
    const map: Record<string, StandardDataType> = {
      text: StandardDataType.STRING,
      textarea: StandardDataType.STRING,
      number: StandardDataType.DECIMAL,
      integer: StandardDataType.INTEGER,
      float: StandardDataType.FLOAT,
      date: StandardDataType.DATE,
      datetime: StandardDataType.DATETIME,
      bool: StandardDataType.BOOLEAN,
      select: StandardDataType.STRING,
      multiselect: StandardDataType.ARRAY,
      reference: StandardDataType.STRING,
      user: StandardDataType.STRING,
      department: StandardDataType.STRING,
      phone: StandardDataType.STRING,
      email: StandardDataType.STRING,
      url: StandardDataType.STRING,
      image: StandardDataType.STRING,
      file: StandardDataType.STRING,
      location: StandardDataType.JSON,
      formula: StandardDataType.STRING,
      autoNumber: StandardDataType.STRING,
    };
    return map[fxkType] || StandardDataType.STRING;
  }
}
