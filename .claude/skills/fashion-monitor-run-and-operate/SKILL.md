---
name: fashion-monitor-run-and-operate
description: How to run and deploy fashion-monitor — dev/prod command anatomy with exact flags, docker-compose service map, Makefile deploy flow, host scheduling, and data/artifact conventions (SQLite path, Poshmark profile, retention, logs). Load when starting the pipeline/dashboard/web/report locally, deploying to the desktop host, wiring compose services, or wondering where output lands. Do NOT load for environment/build failures (fashion-monitor-build-and-env), config semantics (fashion-monitor-config-and-flags), or diagnosing a broken run (fashion-monitor-debugging-playbook).
---

# Run and Operate (fashion-monitor)

Verified 2026-07-02 against the uncommitted working tree (compose already reflects the in-flight ntfy migration).

## Dev commands (from repo root, after fashion-monitor-build-and-env setup)

| Command | What it does | Flags / env |
|---|---|---|
| `pnpm run dev:run` | One pipeline run (tsx, no build) | `-- --config config.yaml --platforms poshmark,depop` (comma list; from `apps/cli/src/args.ts`) |
| `pnpm run dev:dashboard` | Fastify API + SPA on :3030 | `-- --config config.yaml --host 0.0.0.0 --port 3030`; env `DASHBOARD_HOST`/`DASHBOARD_PORT`; set `ADMIN_EMAIL`/`ADMIN_PASSWORD` to bootstrap the first owner |
| `pnpm run dev:web` | Vite SPA on :5173, proxies `/api` → :3030 | run alongside dev:dashboard |
| `pnpm run dev:report` | CLI analytics report | `-- --config config.yaml --days 14` |
| `pnpm run dev:feedback` | **Disabled stub** — logs `status: "disabled"` and exits usefulness (Telegram removal, mid-migration) | see fashion-monitor-alerting-feedback-campaign |

Prod equivalents (after `pnpm run build`): `node apps/cli/dist/{run,dashboard,report,feedback-bot}.js` with the same flags, or `pnpm run start:*`.

MCP server: `services/mcp-server`, SSE on `MCP_PORT` (default 3102); container env `MCP_CONFIG_PATH=/data/config.yaml`, `DB_PATH=/data/fashion_monitor.db`. Four tools: search_listings, get_recent_alerts, add_monitor, get_taste.

## docker-compose service map (docker-compose.yml)

| Service | Image | Runs | Notes |
|---|---|---|---|
| `scraper` | fashion-monitor/cli | `run.js --config /data/config.yaml` | `restart: "no"` — cron-triggered, one-shot |
| `poshmark` | fashion-monitor/cli | `run.js --platforms poshmark` | separate slower cadence |
| `feedback-bot` | fashion-monitor/cli | `feedback-bot.js` | behind compose profile `feedback` — does NOT start by default; currently a disabled stub anyway |
| `ntfy` | binwiederhier/ntfy | alert push server | host port `${NTFY_PORT:-8282}`→80; cache+auth volumes |
| `dashboard` | fashion-monitor/cli | `dashboard.js --host 0.0.0.0 --port 3030` | host port `3030:3030`, plain HTTP (no bundled proxy); `COOKIE_SECURE` defaults `false` |
| `mcp-server` | fashion-monitor/mcp-server | MCP SSE | port `${MCP_PORT:-3102}` |
| `dashboard-report` | fashion-monitor/cli | `report.js` | profile `tools`, on-demand |
| `grafana` | grafana/grafana:11.5.2 | dashboards | host port `${GRAFANA_PORT:-3001}` → **NOT :3000; README's ":3000" is stale** — sqlite datasource plugin, `./data` mounted read-only |
| `loki` / `promtail` | grafana 3.4.2 images | log aggregation | profile `loki` — opt-in: `docker compose --profile loki up -d loki promtail` |

All app services mount `./data:/data` and read `.env` via `env_file`. Log-shipping label `fm.logging: "true"` marks containers promtail scrapes.

## Deploy (Makefile — read it before every deploy; do not deploy without owner sign-off)

```bash
make build    # buildx linux/amd64 → fashion-monitor/cli + fashion-monitor/mcp-server (--load)
make push     # docker save both | ssh $(DEPLOY_USER)@$(DEPLOY_HOST) docker load
make sync     # tar compose+config.yaml+grafana/ → $(DEPLOY_PATH); NEVER syncs .env or data/
make deploy   # sync + push + remote `docker compose up -d`
```

Variables: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH` (defaults in Makefile; override per env — Preston's own real values live outside this public repo, see the untracked local `CLAUDE.md`). First deploy: create `$(DEPLOY_PATH)/data/.env` on the deploy host with `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ENCRYPTION_KEY` (confirmed live keys, 2026-07-19 — ignore the ntfy-vars note from an earlier version of this file, it didn't match the actual deployed `.env`).

Pre-flight: deploy host must be x86_64 (`uname -m`) for Playwright Chromium; Ollama must be reachable **from inside the container** (`curl` the `llm.ollama_host` URL from a container, not the host).

Scheduling (moved off Synology Task Scheduler with the 2026-07-19 NAS→desktop migration): use cron or a systemd timer on the deploy host running `docker compose run --rm scraper` every 60 min and `docker compose run --rm poshmark` every 3 h; dashboard+grafana always-on (`restart: unless-stopped`); feedback-bot always-on under profile `feedback` (currently moot — stub, see fashion-monitor-alerting-feedback-campaign).

## Data and artifact conventions

| Artifact | Location | Notes |
|---|---|---|
| SQLite DB | `data/fashion_monitor.db` (host) = `/data/fashion_monitor.db` (container) | gitignored; the only state store |
| Poshmark browser profile | `data/poshmark-profile` | persistent login/session for stealth scraping; keep the volume |
| config | `config.yaml` at root (dev) / `$(DEPLOY_PATH)/config.yaml` (deploy host) | bootstrap-only for most keys (ADR-007) |
| Logs | stdout JSON (Pino) → `docker compose logs`; optional Loki | filter with jq by event id |
| Retention | 90 days `seen_listings`, 30 days `runs` (spec/01, pruning in `packages/core/src/storage/prune.ts`) | |
| Coverage / e2e artifacts | `coverage/`, `test-results/` | disposable |
| Turbo cache | `.turbo/` | disposable |

## When NOT to use this skill

- `pnpm install`/build/typecheck failures → **fashion-monitor-build-and-env**
- What a config key means / why an edit didn't take → **fashion-monitor-config-and-flags**
- Run started but misbehaves → **fashion-monitor-debugging-playbook**
- Measuring output quality → **fashion-monitor-diagnostics-and-tooling**

## Provenance and maintenance

- Service map: `grep -n "^  [a-z-]*:" docker-compose.yml`
- Grafana host port still 3001: `grep -n "GRAFANA_PORT" docker-compose.yml`
- feedback-bot still profile-gated/stub: `grep -n -A3 "feedback-bot:" docker-compose.yml && head -12 apps/cli/src/feedback-bot.ts`
- CLI flags: `cat apps/cli/src/args.ts`
- Makefile flow + stale TELEGRAM hints: `cat Makefile`
- Retention: `grep -n "90\|30" packages/core/src/storage/prune.ts spec/01-overview.md`
