# CronJobMonitoring

A self-hosted uptime and health-monitoring dashboard. It periodically checks a configurable list of services ("monitors"), stores every result, and pushes a live notification the moment any monitor's status changes.

The whole app — REST API, WebSocket alerts, and the React frontend — ships as a single Go binary backed by PostgreSQL.

## Features

- **9 check types**: `ping`, `tcp`, `http`/`https`, `postgres`, `heartbeat` (passive check-in), `docker` (container health), `zabbix` (JSON-RPC integration), `script` (external script, exit-code based), and `custom` (freeform HTTP headers or inline script)
- **Real-time alerts** — the moment a monitor's status changes (e.g. UP → DOWN), every connected dashboard gets a live WebSocket push and a toast notification
- **Full check history** — every check result is stored, not just the latest one, with a 30-day retention window
- **Bearer-token API auth** — tokens are hashed (SHA-256) before storage and shown in plaintext only once, at creation
- **Bulk import** monitors from an Excel file
- **Manual "Check Now"** to run a check outside its normal schedule

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Go, [chi](https://github.com/go-chi/chi) router |
| Database | PostgreSQL via [pgx](https://github.com/jackc/pgx) |
| Real-time | WebSocket via [gorilla/websocket](https://github.com/gorilla/websocket) |
| Secrets (optional) | HashiCorp Vault |
| Frontend | React + TypeScript, Vite, Tailwind CSS, react-router-dom |

## Getting Started

### Prerequisites
- Go 1.2x+
- Node.js + npm
- PostgreSQL instance
- (Optional) HashiCorp Vault, if you want secrets pulled from Vault instead of plaintext config

### Setup

```powershell
# clone
git clone https://github.com/AVR003/CronJobMonitoring.git
cd CronJobMonitoring

# configure environment
cp .env.example .env   # then edit with your DB connection details, port, etc.

# build the frontend
cd frontend
npm install
npm run build
cd ..

# run the backend (serves the built frontend + API)
go run main.go
```

On first run, the schema is created automatically (`db/schema.sql`), and an initial API token is seeded if `INITIAL_API_TOKEN` is set in your environment — use that token to log into the dashboard.

### Development

Run the frontend in dev mode with hot reload (proxies API calls to the Go backend on `:8080`):
```powershell
cd frontend
npm run dev
```

Run the backend separately:
```powershell
go run main.go
```

## Project Structure

```
├── api/          REST API handlers, auth middleware, routing
├── checks/       Check-type implementations (tcp, http, docker, zabbix, ...)
├── config/       Environment-based configuration loading
├── db/           Database connection + schema
├── models/       Shared Go structs (Monitor, CheckResult)
├── runner/       Background scheduler + WebSocket alert hub
├── vault/        Optional HashiCorp Vault client
├── frontend/     React + TypeScript dashboard (Vite)
└── main.go       Entry point
```

## API Overview

All endpoints under `/api` (except `/api/health`) require an `Authorization: Bearer <token>` header.

| Endpoint | Description |
|---|---|
| `GET /api/status` | Dashboard summary — all monitors with their latest result |
| `GET/POST /api/monitors` | List / create monitors |
| `GET/PUT/DELETE /api/monitors/{id}` | Get / update / delete a monitor |
| `PATCH /api/monitors/{id}/toggle` | Enable / disable a monitor |
| `POST /api/monitors/{id}/check-now` | Run a check immediately |
| `POST /api/monitors/{id}/heartbeat` | Check-in endpoint for passive heartbeat monitors |
| `GET /api/monitors/{id}/results` | Last 100 check results |
| `GET/POST/DELETE /api/tokens` | Manage API tokens |
| `WS /ws/alerts` | Live status-change events |

## Known Limitations

- Alerts are live-only — there's currently no persisted, queryable alarm history or acknowledge/resolve lifecycle (the schema has groundwork for this in `alert_events`, not yet wired up)
- No automatic WebSocket reconnect on the frontend — a dropped connection needs a page refresh
- `script`/`custom` (script mode) monitor types execute arbitrary commands on the host with no sandboxing — only trusted users should be able to configure these