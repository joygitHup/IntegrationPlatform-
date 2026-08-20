import type { IConnector, ConnectorMetadata, StandardDataType } from './types';
import type { AuthMethod } from './base';

/**
 * SFTP 连接器
 * 生产环境需安装 ssh2-sftp-client: pnpm add ssh2-sftp-client
 */
export class SftpConnector implements IConnector {
  readonly type = 'sftp';
  readonly name = 'SFTP';
  readonly metadata: ConnectorMetadata = {
    type: 'sftp',
    name: 'SFTP',
    category: 'file',
    description: 'SFTP 文件传输连接器，支持文件下载、上传、目录监听',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true, placeholder: 'sftp.example.com' },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 22 },
        { name: 'username', label: '用户名', type: 'string', required: true },
        { name: 'authType', label: '认证方式', type: 'select', defaultValue: 'password',
          options: [
            { label: '密码认证', value: 'password' },
            { label: '私钥认证', value: 'apikey' },
          ] },
        { name: 'password', label: '密码', type: 'password', required: false, sensitive: true,
          description: '密码认证时使用' },
        { name: 'privateKey', label: '私钥内容', type: 'textarea', required: false, sensitive: true,
          description: '私钥认证时使用，PEM格式' },
        { name: 'passphrase', label: '私钥密码', type: 'password', required: false, sensitive: true,
          description: '私钥有密码保护时填写' },
        { name: 'remoteDir', label: '远程目录', type: 'string', required: true, defaultValue: '/upload',
          description: '默认操作的远程目录' },
        { name: 'filePattern', label: '文件匹配模式', type: 'string', defaultValue: '*.csv',
          description: 'Glob模式，如 *.csv、data_*.txt' },
        { name: 'encoding', label: '文件编码', type: 'select', defaultValue: 'utf-8',
          options: [
            { label: 'UTF-8', value: 'utf-8' },
            { label: 'GBK', value: 'gbk' },
            { label: 'GB2312', value: 'gb2312' },
            { label: 'ISO-8859-1', value: 'latin1' },
          ] },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 30 },
        { name: 'keepaliveInterval', label: '心跳间隔(秒)', type: 'number', defaultValue: 60 },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.host) errors.push('主机地址不能为空');
    if (!config.port) errors.push('端口不能为空');
    if (!config.username) errors.push('用户名不能为空');
    if (config.authType === 'password' && !config.password) {
      errors.push('密码认证时密码不能为空');
    }
    if (config.authType === 'apikey' && !config.privateKey) {
      errors.push('私钥认证时私钥不能为空');
    }
    if (!config.remoteDir) errors.push('远程目录不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      // TCP层连通性测试
      const net = await import('net');
      await new Promise<void>((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout((config.connectTimeout || 30) * 1000);
        sock.on('connect', () => {
          // 读取SSH banner
          sock.once('data', () => { sock.destroy(); resolve(); });
        });
        sock.on('error', reject);
        sock.on('timeout', () => { sock.destroy(); reject(new Error('连接超时')); });
        sock.connect(config.port, config.host);
      });
      return { success: true, latencyMs: Date.now() - start, message: 'SSH端口连通正常（生产环境需安装ssh2-sftp-client进行协议级测试）' };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}

/**
 * FTP 连接器
 */
export class FtpConnector implements IConnector {
  readonly type = 'ftp';
  readonly name = 'FTP';
  readonly metadata: ConnectorMetadata = {
    type: 'ftp',
    name: 'FTP',
    category: 'file',
    description: 'FTP 文件传输连接器，适用于传统文件服务器',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'host', label: '主机地址', type: 'string', required: true },
        { name: 'port', label: '端口', type: 'number', required: true, defaultValue: 21 },
        { name: 'username', label: '用户名', type: 'string', required: true },
        { name: 'password', label: '密码', type: 'password', required: true, sensitive: true },
        { name: 'remoteDir', label: '远程目录', type: 'string', defaultValue: '/' },
        { name: 'secure', label: '启用FTPS', type: 'boolean', defaultValue: false },
        { name: 'passive', label: '被动模式', type: 'boolean', defaultValue: true },
        { name: 'filePattern', label: '文件匹配模式', type: 'string', defaultValue: '*.*' },
        { name: 'encoding', label: '文件编码', type: 'select', defaultValue: 'utf-8',
          options: [
            { label: 'UTF-8', value: 'utf-8' },
            { label: 'GBK', value: 'gbk' },
          ] },
        { name: 'connectTimeout', label: '连接超时(秒)', type: 'number', defaultValue: 30 },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.host) errors.push('主机地址不能为空');
    if (!config.port) errors.push('端口不能为空');
    if (!config.username) errors.push('用户名不能为空');
    if (!config.password) errors.push('密码不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      const net = await import('net');
      await new Promise<void>((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout((config.connectTimeout || 30) * 1000);
        sock.on('connect', () => {
          sock.once('data', (data: Buffer) => {
            const banner = data.toString();
            sock.destroy();
            if (banner.startsWith('220')) resolve();
            else reject(new Error('非FTP服务: ' + banner.substring(0, 50)));
          });
        });
        sock.on('error', reject);
        sock.on('timeout', () => { sock.destroy(); reject(new Error('连接超时')); });
        sock.connect(config.port, config.host);
      });
      return { success: true, latencyMs: Date.now() - start, message: 'FTP端口连通正常' };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}

/**
 * 对象存储 S3 兼容连接器（支持 S3/OSS/MinIO/Ceph）
 */
export class S3Connector implements IConnector {
  readonly type = 's3';
  readonly name = 'S3 对象存储';
  readonly metadata: ConnectorMetadata = {
    type: 's3',
    name: 'S3 对象存储',
    category: 'file',
    description: 'S3 兼容对象存储连接器（AWS S3、阿里云OSS、MinIO、腾讯云COS等）',
    typeSupport: 'both',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'provider', label: '服务商', type: 'select', defaultValue: 'minio',
          options: [
            { label: 'MinIO', value: 'minio' },
            { label: '阿里云 OSS', value: 'aliyun-oss' },
            { label: 'AWS S3', value: 'aws-s3' },
            { label: '腾讯云 COS', value: 'tencent-cos' },
            { label: '自定义', value: 'custom' },
          ] },
        { name: 'endpoint', label: 'Endpoint', type: 'string', required: true, placeholder: 'oss-cn-hangzhou.aliyuncs.com',
          description: '区域端点地址' },
        { name: 'accessKeyId', label: 'Access Key ID', type: 'string', required: true },
        { name: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true, sensitive: true },
        { name: 'bucket', label: 'Bucket名称', type: 'string', required: true },
        { name: 'region', label: '区域', type: 'string', defaultValue: 'us-east-1' },
        { name: 'prefix', label: '前缀/目录', type: 'string', defaultValue: '', description: '默认操作的对象前缀' },
        { name: 'forcePathStyle', label: '路径风格', type: 'boolean', defaultValue: false,
          description: 'MinIO需要开启；OSS/S3默认关闭' },
        { name: 'ssl', label: '启用SSL', type: 'boolean', defaultValue: true },
        { name: 'signatureVersion', label: '签名版本', type: 'select', defaultValue: 'v4',
          options: [
            { label: 'v4', value: 'v4' },
            { label: 'v2', value: 'v2' },
          ] },
        { name: 'connectTimeout', label: '连接超时(毫秒)', type: 'number', defaultValue: 10000 },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.endpoint) errors.push('Endpoint不能为空');
    if (!config.accessKeyId) errors.push('Access Key ID不能为空');
    if (!config.secretAccessKey) errors.push('Secret Access Key不能为空');
    if (!config.bucket) errors.push('Bucket名称不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      const endpoint = config.endpoint.replace(/^https?:\/\//, '');
      const url = `${config.ssl ? 'https' : 'http'}://${endpoint}/${config.bucket}`;
      const response = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout((config.connectTimeout || 10000)),
      });
      // HEAD请求bucket会返回403(没权限但存在)或404(不存在)或200(有list权限)
      const exists = response.status !== 404;
      return {
        success: exists,
        latencyMs: Date.now() - start,
        message: exists
          ? `Bucket存在（HTTP ${response.status}，生产环境需安装AWS SDK进行完整验证）`
          : `Bucket不存在或无法访问（HTTP ${response.status}）`,
      };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, message: err.message };
    }
  }
}

/**
 * Excel/CSV 文件连接器
 */
export class FileConnector implements IConnector {
  readonly type = 'csv_excel';
  readonly name = 'CSV/Excel 文件';
  readonly metadata: ConnectorMetadata = {
    type: 'csv_excel',
    name: 'CSV/Excel 文件',
    category: 'file',
    description: 'CSV/Excel 文件连接器，支持本地和远程文件解析与写入',
    typeSupport: 'target',
    version: '1.0.0',
    configSchema: {
      fields: [
        { name: 'fileType', label: '文件类型', type: 'select', defaultValue: 'csv',
          options: [
            { label: 'CSV', value: 'csv' },
            { label: 'TSV', value: 'tsv' },
            { label: 'Excel (.xlsx)', value: 'xlsx' },
            { label: 'JSON Lines', value: 'jsonl' },
          ] },
        { name: 'delimiter', label: '分隔符', type: 'string', defaultValue: ',', description: 'CSV时使用' },
        { name: 'hasHeader', label: '包含表头', type: 'boolean', defaultValue: true },
        { name: 'encoding', label: '文件编码', type: 'select', defaultValue: 'utf-8',
          options: [
            { label: 'UTF-8', value: 'utf-8' },
            { label: 'GBK', value: 'gbk' },
            { label: 'GB2312', value: 'gb2312' },
          ] },
        { name: 'sheetName', label: 'Sheet名称', type: 'string', defaultValue: 'Sheet1',
          description: 'Excel时使用' },
        { name: 'batchSize', label: '批处理行数', type: 'number', defaultValue: 1000 },
        { name: 'dateFormat', label: '日期格式', type: 'string', defaultValue: 'YYYY-MM-DD HH:mm:ss' },
      ],
    },
  };

  validateConfig(config: Record<string, any>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (!config.fileType) errors.push('文件类型不能为空');
    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  async testConnection(config: Record<string, any>): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    return { success: true, latencyMs: 0, message: '文件连接器无需连接测试' };
  }
}
