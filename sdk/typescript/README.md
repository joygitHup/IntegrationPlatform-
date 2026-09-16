# 集成中台 TypeScript SDK

```ts
import { IntegrationHub } from './src/index.ts';

const hub = new IntegrationHub({
  apiKey: 'ipk_...',
  baseUrl: 'http://127.0.0.1:8000/api',
});
await hub.catalog();
await hub.triggerJob('job_xxx');
```

自助开户：

```ts
const data = await IntegrationHub.register({ name: '我的公司', code: 'partner_demo' });
const hub = new IntegrationHub({ apiKey: data.apiKey });
await hub.me();
await hub.datasources(); // 含控制台指派给该 Key 的数据源
```

规范：`GET /api/open/openapi.json`。
