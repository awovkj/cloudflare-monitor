# Cloudflare Analytics Dashboard (Workers + D1)

多账户、多 Zone 的 Cloudflare 流量分析仪表盘，已重构为 Cloudflare Workers + D1 架构。

中文 | [English](./README_EN.md)

## 技术栈

- 前端：React + Recharts（保留原显示效果）
- 后端：Cloudflare Workers
- 数据库：Cloudflare D1
- 静态托管：Workers Assets

## 架构说明

- `/api/analytics`：读取 D1 最新快照
- `/api/refresh`：手动刷新并写入 D1（POST）
- `/api/status`：运行状态与快照信息
- `/health`：健康检查
- 定时任务：每 2 小时自动拉取 Cloudflare GraphQL 数据并存入 D1

## 快速开始

1. 安装依赖

```bash
npm install
npm --prefix web install
```

2. 构建前端静态资源

```bash
npm run build:web
```

3. 创建 D1 数据库（首次）

```bash
wrangler d1 create cloudflare_monitor_db
```

4. 将创建出的 `database_id` 填入 `wrangler.toml`

5. 执行 D1 迁移

```bash
npm run d1:migrate
```

6. 配置 Cloudflare 账户信息（推荐使用 secret）

```bash
wrangler secret put CF_CONFIG
```

`CF_CONFIG` 示例：

```json
{
  "accounts": [
    {
      "name": "主账号",
      "token": "your_token",
      "zones": [
        { "zone_id": "zone1", "domain": "example.com" },
        { "zone_id": "zone2", "domain": "cdn.example.com" }
      ]
    }
  ]
}
```

7. 本地开发与部署

```bash
npm run dev
npm run deploy
```

## Cloudflare Token 权限

- `Account | Analytics | Read`
- `Zone | Analytics | Read`
- `Zone | Zone | Read`

## 项目结构

```text
├── web/                    # 前端 React 应用
├── worker/                 # Workers 代码与 D1 迁移
├── wrangler.toml           # Workers 配置
└── .env.example            # 环境变量示例
```
