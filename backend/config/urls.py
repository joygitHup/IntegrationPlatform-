"""
全局 URL 路由。

路径与前端 src/lib/api-client.ts、Next.js /api 完全对齐，均挂在 /api 下且无尾斜杠。

API 版本策略：
- /api/v1/ 为当前推荐版本入口，前端 NEXT_PUBLIC_API_BASE 应指向 http://127.0.0.1:8000/api/v1。
- /api/ 为历史兼容别名，与 /api/v1/ 解析到同一套 core.urls 路由，保证存量调用方与 SDK 不破坏。
- 新版本（v2 等）上线时，在下方新增对应 path("api/v2/", include(...)) 即可，老版本保留以做灰度回退。
"""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    # 当前推荐版本入口
    path("api/v1/", include("core.urls")),
    # 历史兼容别名：等价于 /api/v1/，后续可在中间件中加 Deprecation 头提示迁移
    path("api/", include("core.urls")),
]
