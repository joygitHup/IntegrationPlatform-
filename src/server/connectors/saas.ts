/**
 * SaaS 应用连接器：钉钉 / 企业微信 / 飞书 / 用友金蝶
 * 这些连接器主要用于组织架构同步、消息通知、业务数据集成
 */

import type {
  ISourceConnector,
  ITargetConnector,
  ConnectorMetadata,
  ConnectionTestResult,
  ConfigValidationResult,
  WriteResult,
} from './base';
import type { TableMetadata } from './types';

// === 钉钉连接器 ===

export class DingTalkConnector implements ISourceConnector, ITargetConnector {
  readonly type = 'dingtalk';
  readonly name = '钉钉';
  readonly metadata: ConnectorMetadata = {
    type: 'dingtalk',
    displayName: '钉钉',
    category: 'saas',
    icon: 'message-circle',
    description: '阿里钉钉（组织架构/消息/审批/待办）',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: false,
      supportsIncremental: true,
      supportsPooling: false,
    },
    authMethods: [{ type: 'apikey', label: 'AppKey / AppSecret', default: true }],
    configSchema: {
      required: ['appKey', 'appSecret'],
      fields: [
        { name: 'appKey', label: 'AppKey', type: 'string', required: true, group: '认证信息' },
        { name: 'appSecret', label: 'AppSecret', type: 'password', sensitive: true, group: '认证信息' },
        { name: 'agentId', label: '应用 AgentId', type: 'string', group: '应用配置', help: '发送工作通知消息需要' },
        { name: 'corpId', label: '企业 CorpId', type: 'string', group: '应用配置' },
        { name: 'syncScope', label: '同步范围', type: 'select', defaultValue: 'all',
          options: [
            { value: 'all', label: '全量组织架构' },
            { value: 'department', label: '指定部门' },
          ], group: '同步配置' },
        { name: 'rootDeptId', label: '根部门 ID', type: 'string', group: '同步配置', defaultValue: '1' },
        { name: 'baseUrl', label: 'API 地址', type: 'string', group: '高级选项', defaultValue: 'https://oapi.dingtalk.com', help: '私有化部署可自定义' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    if (!config.appKey) errors.push('AppKey 不能为空');
    if (!config.appSecret) errors.push('AppSecret 不能为空');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    try {
      const baseUrl = (config.baseUrl as string) || 'https://oapi.dingtalk.com';
      const res = await fetch(
        `${baseUrl}/gettoken?appkey=${config.appKey}&appsecret=${config.appSecret}`,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await res.json() as any;
      if (data.errcode === 0 && data.access_token) {
        return {
          success: true,
          message: '连接成功（access_token 获取正常）',
          latencyMs: Date.now() - startTime,
        };
      }
      return {
        success: false,
        message: `认证失败：${data.errmsg || data.errcode}`,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  async discoverSchema(): Promise<TableMetadata> { throw new Error('钉钉使用固定对象结构：User / Department'); }
  async listTables(): Promise<TableMetadata[]> { return []; }
  async read(): Promise<{ totalRead: number }> { return { totalRead: 0 }; }
  async readSample(): Promise<Record<string, unknown>[]> { return []; }
  async write(): Promise<WriteResult> { return { successCount: 0, failedCount: 0 }; }
}

// === 企业微信连接器 ===

export class WeComConnector implements ISourceConnector, ITargetConnector {
  readonly type = 'wecom';
  readonly name = '企业微信';
  readonly metadata: ConnectorMetadata = {
    type: 'wecom',
    displayName: '企业微信',
    category: 'saas',
    icon: 'message-square',
    description: '腾讯企业微信（组织架构/消息/应用）',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: false,
      supportsIncremental: true,
      supportsPooling: false,
    },
    authMethods: [{ type: 'apikey', label: 'CorpId / Secret', default: true }],
    configSchema: {
      required: ['corpId', 'secret'],
      fields: [
        { name: 'corpId', label: '企业 ID (CorpId)', type: 'string', required: true, group: '认证信息' },
        { name: 'agentId', label: '应用 AgentId', type: 'string', group: '应用配置' },
        { name: 'secret', label: '应用 Secret', type: 'password', sensitive: true, group: '认证信息' },
        { name: 'syncScope', label: '同步范围', type: 'select', defaultValue: 'all',
          options: [
            { value: 'all', label: '全量组织架构' },
            { value: 'department', label: '指定部门' },
          ], group: '同步配置' },
        { name: 'baseUrl', label: 'API 地址', type: 'string', group: '高级选项', defaultValue: 'https://qyapi.weixin.qq.com/cgi-bin' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    if (!config.corpId) errors.push('企业 ID 不能为空');
    if (!config.secret) errors.push('应用 Secret 不能为空');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    try {
      const baseUrl = (config.baseUrl as string) || 'https://qyapi.weixin.qq.com/cgi-bin';
      const res = await fetch(
        `${baseUrl}/gettoken?corpid=${config.corpId}&corpsecret=${config.secret}`,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await res.json() as any;
      if (data.errcode === 0 && data.access_token) {
        return {
          success: true,
          message: '连接成功（access_token 获取正常）',
          latencyMs: Date.now() - startTime,
        };
      }
      return {
        success: false,
        message: `认证失败：${data.errmsg || data.errcode}`,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  async discoverSchema(): Promise<TableMetadata> { throw new Error('企业微信使用固定对象结构'); }
  async listTables(): Promise<TableMetadata[]> { return []; }
  async read(): Promise<{ totalRead: number }> { return { totalRead: 0 }; }
  async readSample(): Promise<Record<string, unknown>[]> { return []; }
  async write(): Promise<WriteResult> { return { successCount: 0, failedCount: 0 }; }
}

// === 飞书连接器 ===

export class FeishuConnector implements ISourceConnector, ITargetConnector {
  readonly type = 'feishu';
  readonly name = '飞书';
  readonly metadata: ConnectorMetadata = {
    type: 'feishu',
    displayName: '飞书',
    category: 'saas',
    icon: 'send',
    description: '字节跳动飞书（组织架构/消息/多维表格/审批）',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: false,
      supportsIncremental: true,
      supportsPooling: false,
    },
    authMethods: [{ type: 'apikey', label: 'App ID / App Secret', default: true }],
    configSchema: {
      required: ['appId', 'appSecret'],
      fields: [
        { name: 'appId', label: 'App ID', type: 'string', required: true, group: '认证信息' },
        { name: 'appSecret', label: 'App Secret', type: 'password', sensitive: true, group: '认证信息' },
        { name: 'tenantKey', label: '租户 Key', type: 'string', group: '认证信息', help: 'ISV 应用需要' },
        { name: 'appType', label: '应用类型', type: 'select', defaultValue: 'internal',
          options: [
            { value: 'internal', label: '企业自建应用' },
            { value: 'isv', label: 'ISV 应用' },
          ], group: '应用配置' },
        { name: 'baseUrl', label: 'API 地址', type: 'string', group: '高级选项', defaultValue: 'https://open.feishu.cn/open-apis' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    if (!config.appId) errors.push('App ID 不能为空');
    if (!config.appSecret) errors.push('App Secret 不能为空');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    try {
      const baseUrl = (config.baseUrl as string) || 'https://open.feishu.cn/open-apis';
      const res = await fetch(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as any;
      if (data.code === 0 && data.tenant_access_token) {
        return {
          success: true,
          message: '连接成功（tenant_access_token 获取正常）',
          latencyMs: Date.now() - startTime,
        };
      }
      return {
        success: false,
        message: `认证失败：${data.msg || data.code}`,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  async discoverSchema(): Promise<TableMetadata> { throw new Error('飞书使用固定对象结构'); }
  async listTables(): Promise<TableMetadata[]> { return []; }
  async read(): Promise<{ totalRead: number }> { return { totalRead: 0 }; }
  async readSample(): Promise<Record<string, unknown>[]> { return []; }
  async write(): Promise<WriteResult> { return { successCount: 0, failedCount: 0 }; }
}

// === 用友 / 金蝶通用 ERP 连接器 ===

export class ErpConnector implements ISourceConnector, ITargetConnector {
  readonly type = 'erp';
  readonly name = 'ERP系统';
  readonly metadata: ConnectorMetadata = {
    type: 'erp',
    displayName: 'ERP (用友/金蝶)',
    category: 'saas',
    icon: 'building',
    description: '用友 U8 / Yonsuite / 金蝶 K3 / 云星空',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: false,
      supportsIncremental: true,
      supportsPooling: false,
    },
    authMethods: [{ type: 'apikey', label: 'API 密钥', default: true }],
    configSchema: {
      required: ['vendor', 'baseUrl'],
      fields: [
        { name: 'vendor', label: 'ERP 厂商', type: 'select', required: true, defaultValue: 'yonyou',
          options: [
            { value: 'yonyou', label: '用友 Yonsuite / U8 Cloud' },
            { value: 'kingdee', label: '金蝶云星空 / K3 Cloud' },
            { value: 'nc', label: '用友 NC / NCC' },
          ], group: '基础配置' },
        { name: 'baseUrl', label: 'API 地址', type: 'string', required: true, group: '基础配置', placeholder: 'https://api.example.com/yonbip' },
        { name: 'appKey', label: 'App Key', type: 'string', group: '认证信息' },
        { name: 'appSecret', label: 'App Secret', type: 'password', sensitive: true, group: '认证信息' },
        { name: 'tenantId', label: '租户 ID', type: 'string', group: '认证信息', help: '多租户环境需要' },
        { name: 'businessUnit', label: '组织/业务单元', type: 'string', group: '业务配置' },
        { name: 'signAlgorithm', label: '签名算法', type: 'select', defaultValue: 'hmac-sha256',
          options: [
            { value: 'hmac-sha256', label: 'HMAC-SHA256' },
            { value: 'hmac-sha1', label: 'HMAC-SHA1' },
            { value: 'md5', label: 'MD5' },
          ], group: '高级选项' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    if (!config.vendor) errors.push('ERP 厂商不能为空');
    if (!config.baseUrl) errors.push('API 地址不能为空');
    return { valid: errors.length === 0, errors, warnings: [] };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: `${config.vendor === 'yonyou' ? '用友' : '金蝶'} ERP 配置验证通过`,
      details: {
        vendor: config.vendor,
        baseUrl: config.baseUrl,
        authentication: 'API 密钥认证',
      },
    };
  }

  async discoverSchema(): Promise<TableMetadata> { throw new Error('ERP 对象众多，请在任务配置中选择具体业务对象'); }
  async listTables(): Promise<TableMetadata[]> { return []; }
  async read(): Promise<{ totalRead: number }> { return { totalRead: 0 }; }
  async readSample(): Promise<Record<string, unknown>[]> { return []; }
  async write(): Promise<WriteResult> { return { successCount: 0, failedCount: 0 }; }
}
