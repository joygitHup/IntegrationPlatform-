# 集成中台 Python SDK

```bash
pip install -e sdk/python
```

```python
from integration_hub import IntegrationHub

hub = IntegrationHub(api_key="ipk_...", base_url="http://127.0.0.1:8000/api")
print(hub.catalog())
print(hub.me())
hub.trigger_job("job_xxx")
```

自助开户：

```python
from integration_hub import IntegrationHub

data = IntegrationHub.register(name="我的公司", code="partner_demo")
hub = IntegrationHub(api_key=data["apiKey"])
print(hub.me())
print(hub.datasources())  # 含控制台指派给该 Key 的数据源
```

规范：`GET /api/open/openapi.json`。
