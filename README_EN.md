# Cloudflare Analytics Dashboard (Workers + D1)

Multi-account, multi-zone Cloudflare traffic analytics dashboard rebuilt on Cloudflare Workers + D1.

English | [中文](./README.md)

## Tech Stack

- Frontend: React + Recharts (same visual output)
- Backend: Cloudflare Workers
- Database: Cloudflare D1
- Static Hosting: Workers Assets

## Architecture

- `/api/analytics`: reads latest analytics snapshot from D1
- `/api/refresh`: refreshes data and stores it in D1 (POST)
- `/api/status`: worker/runtime status and snapshot metadata
- `/health`: health check endpoint
- Cron trigger: refreshes Cloudflare GraphQL analytics every 2 hours

## Quick Start

1. Install dependencies

```bash
npm install
npm --prefix web install
```

2. Build frontend assets

```bash
npm run build:web
```

3. Create D1 database (first time)

```bash
wrangler d1 create cloudflare_monitor_db
```

4. Copy the generated `database_id` into `wrangler.toml`

5. Apply D1 migrations

```bash
npm run d1:migrate
```

6. Configure Cloudflare account config (recommended as secret)

```bash
wrangler secret put CF_CONFIG
```

`CF_CONFIG` example:

```json
{
  "accounts": [
    {
      "name": "Primary Account",
      "token": "your_token",
      "zones": [
        { "zone_id": "zone1", "domain": "example.com" },
        { "zone_id": "zone2", "domain": "cdn.example.com" }
      ]
    }
  ]
}
```

7. Local dev and deployment

```bash
npm run dev
npm run deploy
```

## Required Cloudflare Token Permissions

- `Account | Analytics | Read`
- `Zone | Analytics | Read`
- `Zone | Zone | Read`

## Project Structure

```text
├── web/                    # React frontend
├── worker/                 # Worker source and D1 migrations
├── wrangler.toml           # Worker configuration
└── .env.example            # env var examples
```
