/**
 * LDAP / Active Directory 连接器
 * 用于企业目录服务的用户和组数据同步
 */

import type {
  IConnector,
  ConnectorMetadata,
  ConnectionTestResult,
  ConfigValidationResult,
} from './base';
import { StandardDataType } from './types';

// ========== LDAP Connector ==========

export class LdapConnector implements IConnector {
  type: string = 'ldap';
  name: string = 'LDAP';
  metadata: ConnectorMetadata = {
    type: 'ldap',
    displayName: 'LDAP 目录服务',
    category: 'database',
    icon: 'users',
    description: '轻量级目录访问协议 (LDAP) 连接器，支持用户、组、组织单元的同步',
    typeSupport: 'both',
    version: '1.0.0',
    capabilities: {
      canRead: true,
      canWrite: true,
      canDiscoverSchema: true,
      supportsFilter: true,
      supportsIncremental: true,
    },
    authMethods: [
      { type: 'password', label: '简单认证 (DN)', default: true },
      { type: 'anonymous', label: '匿名绑定' },
    ],
    configSchema: {
      required: ['url', 'baseDn'],
      fields: [
        { name: 'url', label: 'LDAP URL', type: 'string', required: true, placeholder: 'ldap://ldap.example.com:389', group: '基础配置', help: 'ldap:// 或 ldaps://' },
        { name: 'baseDn', label: '基础 DN', type: 'string', required: true, placeholder: 'dc=example,dc=com', group: '基础配置', help: '搜索的根节点' },
        { name: 'bindDn', label: '绑定 DN', type: 'string', group: '认证配置', placeholder: 'cn=admin,dc=example,dc=com' },
        { name: 'bindPassword', label: '绑定密码', type: 'password', sensitive: true, group: '认证配置' },
        { name: 'userBaseDn', label: '用户基础 DN', type: 'string', group: '用户配置', placeholder: 'ou=users,dc=example,dc=com', help: '用户搜索起始节点' },
        { name: 'groupBaseDn', label: '组基础 DN', type: 'string', group: '用户配置', placeholder: 'ou=groups,dc=example,dc=com', help: '组搜索起始节点' },
        { name: 'userObjectClass', label: '用户对象类', type: 'string', defaultValue: 'inetOrgPerson', group: '用户配置' },
        { name: 'groupObjectClass', label: '组对象类', type: 'string', defaultValue: 'groupOfNames', group: '用户配置' },
        { name: 'userNameAttribute', label: '用户名属性', type: 'string', defaultValue: 'uid', group: '用户配置' },
        { name: 'groupNameAttribute', label: '组名属性', type: 'string', defaultValue: 'cn', group: '用户配置' },
        { name: 'memberAttribute', label: '成员属性', type: 'string', defaultValue: 'member', group: '用户配置' },
        { name: 'tls', label: '启用 TLS', type: 'boolean', defaultValue: false, group: '安全选项' },
        { name: 'rejectUnauthorized', label: '验证证书', type: 'boolean', defaultValue: true, group: '安全选项' },
        { name: 'connectTimeout', label: '连接超时(毫秒)', type: 'number', defaultValue: 10000, group: '高级选项' },
        { name: 'idleTimeout', label: '空闲超时(毫秒)', type: 'number', defaultValue: 30000, group: '高级选项' },
      ],
    },
  };

  validateConfig(config: Record<string, unknown>): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!config.url) errors.push('LDAP URL 不能为空');
    if (config.url && !String(config.url).startsWith('ldap')) {
      errors.push('URL 必须以 ldap:// 或 ldaps:// 开头');
    }
    if (!config.baseDn) errors.push('基础 DN 不能为空');
    if (config.bindDn && !config.bindPassword) warnings.push('已配置绑定 DN 但未配置密码，将使用匿名绑定');
    if (config.bindPassword && !config.bindDn) warnings.push('已配置密码但未配置绑定 DN');
    return { valid: errors.length === 0, errors, warnings };
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      return { success: false, message: validation.errors.join('; '), latencyMs: Date.now() - startTime };
    }

    try {
      const ldap = await import('ldapjs');
      const client = ldap.createClient({
        url: config.url as string,
        timeout: (config.connectTimeout as number) || 10000,
        idleTimeout: (config.idleTimeout as number) || 30000,
        tlsOptions: config.tls ? { rejectUnauthorized: config.rejectUnauthorized !== false } : undefined,
      });

      try {
        if (config.bindDn && config.bindPassword) {
          await new Promise<void>((resolve, reject) => {
            client.bind(config.bindDn as string, config.bindPassword as string, (err: any) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } else {
          // 匿名绑定 - 执行一次简单搜索测试连通性
          await new Promise<void>((resolve, reject) => {
            client.search(config.baseDn as string, { scope: 'base', attributes: ['objectClass'], sizeLimit: 1 }, (err: any, res: any) => {
              if (err) {
                reject(err);
                return;
              }
              res.on('searchEntry', () => resolve());
              res.on('error', reject);
              res.on('end', (result: any) => {
                if (result?.status === 0) resolve();
                else reject(new Error(`搜索失败，状态码: ${result?.status}`));
              });
            });
          });
        }

        const latency = Date.now() - startTime;
        client.unbind(() => {});
        return {
          success: true,
          message: 'LDAP 连接成功',
          latencyMs: latency,
          details: { url: config.url, baseDn: config.baseDn, auth: config.bindDn ? 'bind' : 'anonymous' },
        };
      } catch (bindErr) {
        const latency = Date.now() - startTime;
        const err = bindErr as Error;
        client.unbind(() => {});
        return {
          success: false,
          message: `连接失败: ${err.message}`,
          latencyMs: latency,
          details: { error: err.name },
        };
      }
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
  mapToStandardType(attrType: string): StandardDataType {
    const map: Record<string, StandardDataType> = {
      '1.3.6.1.4.1.1466.115.121.1.15': StandardDataType.STRING,  // DirectoryString
      '1.3.6.1.4.1.1466.115.121.1.27': StandardDataType.INTEGER, // Integer
      '1.3.6.1.4.1.1466.115.121.1.7': StandardDataType.BOOLEAN,  // Boolean
      '1.3.6.1.4.1.1466.115.121.1.24': StandardDataType.DATETIME, // GeneralizedTime
      '1.3.6.1.4.1.1466.115.121.1.5': StandardDataType.BINARY,   // Binary
      '1.3.6.1.4.1.1466.115.121.1.12': StandardDataType.STRING,  // DN
    };
    return map[attrType] || StandardDataType.STRING;
  }

  // ========= 搜索 =========
  async search(
    config: Record<string, unknown>,
    baseDn: string,
    options: {
      filter?: string;
      scope?: 'base' | 'one' | 'sub';
      attributes?: string[];
      sizeLimit?: number;
    } = {}
  ): Promise<Record<string, unknown>[]> {
    const ldap = await import('ldapjs');
    const client = ldap.createClient({
      url: config.url as string,
      timeout: (config.connectTimeout as number) || 10000,
    });

    return new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const results: Record<string, unknown>[] = [];

      const onError = (err: Error) => {
        try { client.unbind(() => {}); } catch { /* ignore */ }
        reject(err);
      };

      const doSearch = () => {
        client.search(baseDn, {
          filter: options.filter || '(objectClass=*)',
          scope: options.scope || 'sub',
          attributes: options.attributes,
          sizeLimit: options.sizeLimit || 1000,
        }, (err: any, res: any) => {
          if (err) {
            onError(err);
            return;
          }

          res.on('searchEntry', (entry: any) => {
            const obj: Record<string, unknown> = { dn: entry.dn };
            entry.attributes.forEach((attr: any) => {
              const vals = attr.values;
              obj[attr.type] = vals.length === 1 ? vals[0] : vals;
            });
            results.push(obj);
          });

          res.on('error', onError);
          res.on('end', (result: any) => {
            client.unbind(() => {});
            if (result?.status === 0 || result?.status === 4) { // 0=success, 4=size limit exceeded (partial results ok)
              resolve(results);
            } else {
              reject(new Error(`搜索失败，状态码: ${result?.status}`));
            }
          });
        });
      };

      if (config.bindDn && config.bindPassword) {
        client.bind(config.bindDn as string, config.bindPassword as string, (bindErr: any) => {
          if (bindErr) onError(bindErr);
          else doSearch();
        });
      } else {
        doSearch();
      }
    });
  }

  // ========= 用户操作 =========
  async listUsers(config: Record<string, unknown>, options?: { filter?: string; attributes?: string[]; limit?: number }): Promise<Record<string, unknown>[]> {
    const userBase = (config.userBaseDn as string) || (config.baseDn as string);
    const objectClass = (config.userObjectClass as string) || 'inetOrgPerson';
    const filter = options?.filter || `(objectClass=${objectClass})`;
    return this.search(config, userBase, {
      filter,
      scope: 'sub',
      attributes: options?.attributes,
      sizeLimit: options?.limit,
    });
  }

  async listGroups(config: Record<string, unknown>, options?: { filter?: string; attributes?: string[]; limit?: number }): Promise<Record<string, unknown>[]> {
    const groupBase = (config.groupBaseDn as string) || (config.baseDn as string);
    const objectClass = (config.groupObjectClass as string) || 'groupOfNames';
    const filter = options?.filter || `(objectClass=${objectClass})`;
    return this.search(config, groupBase, {
      filter,
      scope: 'sub',
      attributes: options?.attributes,
      sizeLimit: options?.limit,
    });
  }

  // ========= 写入操作 =========
  async addEntry(config: Record<string, unknown>, dn: string, entry: Record<string, unknown>): Promise<void> {
    const ldap = await import('ldapjs');
    const client = ldap.createClient({ url: config.url as string });

    return new Promise<void>((resolve, reject) => {
      const doAdd = () => {
        client.add(dn, entry, (err: any) => {
          client.unbind(() => {});
          if (err) reject(err);
          else resolve();
        });
      };

      if (config.bindDn && config.bindPassword) {
        client.bind(config.bindDn as string, config.bindPassword as string, (bindErr: any) => {
          if (bindErr) {
            client.unbind(() => {});
            reject(bindErr);
          } else {
            doAdd();
          }
        });
      } else {
        doAdd();
      }
    });
  }

  async modifyEntry(config: Record<string, unknown>, dn: string, changes: Array<{ operation: 'add' | 'delete' | 'replace'; modification: Record<string, unknown> }>): Promise<void> {
    const ldap = await import('ldapjs');
    const client = ldap.createClient({ url: config.url as string });

    return new Promise<void>((resolve, reject) => {
      const doModify = () => {
        const ldapChanges = changes.map(c => new ldap.Change({
          operation: c.operation,
          modification: c.modification,
        }));
        client.modify(dn, ldapChanges, (err: any) => {
          client.unbind(() => {});
          if (err) reject(err);
          else resolve();
        });
      };

      if (config.bindDn && config.bindPassword) {
        client.bind(config.bindDn as string, config.bindPassword as string, (bindErr: any) => {
          if (bindErr) {
            client.unbind(() => {});
            reject(bindErr);
          } else {
            doModify();
          }
        });
      } else {
        doModify();
      }
    });
  }

  async deleteEntry(config: Record<string, unknown>, dn: string): Promise<void> {
    const ldap = await import('ldapjs');
    const client = ldap.createClient({ url: config.url as string });

    return new Promise<void>((resolve, reject) => {
      const doDelete = () => {
        client.del(dn, (err: any) => {
          client.unbind(() => {});
          if (err) reject(err);
          else resolve();
        });
      };

      if (config.bindDn && config.bindPassword) {
        client.bind(config.bindDn as string, config.bindPassword as string, (bindErr: any) => {
          if (bindErr) {
            client.unbind(() => {});
            reject(bindErr);
          } else {
            doDelete();
          }
        });
      } else {
        doDelete();
      }
    });
  }
}

// ========== Active Directory Connector ==========
// AD 是 LDAP 的一个特殊实现，有一些差异：
// - 用户对象类通常是 user
// - 组对象类通常是 group
// - 用户名属性通常是 sAMAccountName
// - 成员属性通常是 member
// - 支持 LDAP 特殊扩展（如范围检索、分页）

export class ActiveDirectoryConnector extends LdapConnector {
  constructor() {
    super();
    this.type = 'active_directory';
    this.name = 'Active Directory';
    this.metadata = {
      type: 'active_directory',
      displayName: 'Active Directory',
      category: 'database',
      icon: 'building-2',
      description: 'Microsoft Active Directory 连接器，支持用户、组、组织单元的同步',
      typeSupport: 'both',
      version: '1.0.0',
      capabilities: {
        canRead: true,
        canWrite: true,
        canDiscoverSchema: true,
        supportsFilter: true,
        supportsIncremental: true,
      },
      authMethods: [
        { type: 'password', label: '简单认证', default: true },
        { type: 'anonymous', label: '匿名绑定' },
      ],
      configSchema: {
        required: ['url', 'baseDn'],
        fields: [
          { name: 'url', label: 'AD URL', type: 'string', required: true, placeholder: 'ldap://dc.example.com:389', group: '基础配置' },
          { name: 'baseDn', label: '基础 DN', type: 'string', required: true, placeholder: 'dc=example,dc=com', group: '基础配置' },
          { name: 'username', label: '登录用户名', type: 'string', group: '认证配置', placeholder: 'admin@example.com', help: 'UPN 格式或 DOMAIN\\username' },
          { name: 'password', label: '登录密码', type: 'password', sensitive: true, group: '认证配置' },
          { name: 'domain', label: '域名', type: 'string', group: '认证配置', placeholder: 'example.com' },
          { name: 'userBaseDn', label: '用户基础 DN', type: 'string', group: '用户配置', placeholder: 'OU=Users,DC=example,DC=com' },
          { name: 'groupBaseDn', label: '组基础 DN', type: 'string', group: '用户配置', placeholder: 'OU=Groups,DC=example,DC=com' },
          { name: 'userNameAttribute', label: '用户名属性', type: 'string', defaultValue: 'sAMAccountName', group: '用户配置' },
          { name: 'groupNameAttribute', label: '组名属性', type: 'string', defaultValue: 'sAMAccountName', group: '用户配置' },
          { name: 'memberAttribute', label: '成员属性', type: 'string', defaultValue: 'member', group: '用户配置' },
          { name: 'pageSize', label: '分页大小', type: 'number', defaultValue: 1000, group: '高级选项' },
          { name: 'tls', label: '启用 TLS (LDAPS)', type: 'boolean', defaultValue: false, group: '安全选项' },
          { name: 'rejectUnauthorized', label: '验证证书', type: 'boolean', defaultValue: true, group: '安全选项' },
        ],
      },
    };
  }

  // AD 特有的用户搜索
  async listAdUsers(config: Record<string, unknown>, options?: { filter?: string; attributes?: string[]; limit?: number }): Promise<Record<string, unknown>[]> {
    const userBase = (config.userBaseDn as string) || (config.baseDn as string);
    const filter = options?.filter || '(&(objectCategory=person)(objectClass=user))';
    return this.search(config, userBase, {
      filter,
      scope: 'sub',
      attributes: options?.attributes,
      sizeLimit: options?.limit,
    });
  }

  // AD 特有的组搜索
  async listAdGroups(config: Record<string, unknown>, options?: { filter?: string; attributes?: string[]; limit?: number }): Promise<Record<string, unknown>[]> {
    const groupBase = (config.groupBaseDn as string) || (config.baseDn as string);
    const filter = options?.filter || '(objectCategory=group)';
    return this.search(config, groupBase, {
      filter,
      scope: 'sub',
      attributes: options?.attributes,
      sizeLimit: options?.limit,
    });
  }

  // AD 特有的用户启用/禁用
  async setUserAccountControl(config: Record<string, unknown>, userDn: string, enabled: boolean): Promise<void> {
    // ACCOUNTDISABLE flag: 0x0002 = 2
    // 注意：AD 的 userAccountControl 是位掩码
    // 简化处理：先读取当前值，再修改
    const results = await this.search(config, userDn, {
      scope: 'base',
      attributes: ['userAccountControl'],
    });
    if (results.length === 0) {
      throw new Error(`用户不存在: ${userDn}`);
    }
    const current = parseInt(String(results[0].userAccountControl || '512'), 10);
    const newValue = enabled ? current & ~2 : current | 2;
    await this.modifyEntry(config, userDn, [
      { operation: 'replace', modification: { userAccountControl: newValue } },
    ]);
  }
}
