# 集成中台 (Integration Platform)

企业级集成枢纽：数据同步、消息、身份、SSO。集成商用 API Key 接入，运营用控制台配置。

现网：**Django API `:8000`** + **Next.js 控制台**（推荐 `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api`）。

更完整的模块说明、页面与接口见 [AGENTS.md](./AGENTS.md)；开放 API 与连接器见 [backend/README.md](./backend/README.md)。

## 快速开始

```bash
# 1. API
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py seed
python manage.py runserver 8000
```

```bash
# 2. 控制台（项目根，另开终端）
pnpm install
# Windows PowerShell
$env:NEXT_PUBLIC_API_BASE="http://127.0.0.1:8000/api"
$env:PORT="5004"
pnpm exec tsx watch src/server.ts
```

浏览器打开控制台地址（上例为 http://127.0.0.1:5004）。  
默认账号：`admin` / `admin123`。

未设置 `NEXT_PUBLIC_API_BASE` 时，控制台会打到 Next 同源 `/api`，与 Django **不是同一套库**。

`pnpm dev` 默认端口 5000。本仓库常用 5004，避免和其它服务抢端口。不要把第二个项目绑到 8000。

## 集成商

- 规范：http://127.0.0.1:8000/api/open/docs  
- 自助沙箱 Key：`POST /api/open/register`  
- SDK：`sdk/python`、`sdk/typescript`

## 技术栈（现网）

- 控制台：Next.js 16、React 19、TypeScript、shadcn/ui、Tailwind CSS 4  
- API：Django REST Framework，JSON camelCase  
- 数据库：PostgreSQL（`DATABASE_URL=postgres://...`）  
- 队列：内存（开发）/ Celery+Redis（生产）  
- 包管理：前端 pnpm；后端 pip  

设计规范：[DESIGN.md](./DESIGN.md)
