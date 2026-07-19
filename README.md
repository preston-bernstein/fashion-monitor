# Fashion Monitor

Personal resale monitoring: scrape eBay, Grailed, Vestiaire, Depop, and Poshmark; score listings with a local LLM against your aesthetic; alert via ntfy.

[![CI](https://github.com/preston-bernstein/fashion-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/preston-bernstein/fashion-monitor/actions/workflows/ci.yml)  [![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6)](tsconfig.base.json)  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Agent policy: [.cursor/rules/no-agent-attribution.mdc](.cursor/rules/no-agent-attribution.mdc) (no AI attribution in commits or code).

## Monorepo layout

pnpm workspaces + Turborepo. Shared contracts live in `@fm/shared`; the SPA imports types/schemas only (HTTP to the API at runtime).

```
packages/
  shared/   @fm/shared — Zod schemas + DTOs (Platform, Capability, monitor inputs, …)
  core/     @fm/core   — pipeline, platforms, storage+migrations, analytics, llm, alerts
  api/      @fm/api    — Fastify JSON API + dashboard server (serves built SPA)
apps/
  web/      @fm/web    — React SPA (Vite 8 / React 19 / Tailwind 4)
  cli/      @fm/cli    — run, report, dashboard entrypoints
```

Dependency graph: `shared` ← `core`, `api`, `web`, `cli`; `core` ← `api`, `cli`; `api` ← `cli`; `web` → `shared` only.

## Quick start (dev)

Requires **Node ≥ 24** and **pnpm** (workspace install).

```bash
cp config.example.yaml config.yaml
cp .env.example .env   # fill in tokens
pnpm install
pnpm test
pnpm run dev:run
```

## Config

- `config.yaml` — aesthetic, price ceilings, enabled platforms, LLM provider
- `.env` — secrets (`NTFY_TOKEN`, `EBAY_*`, `GRAILED_*`, optional `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `SECRETS_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`)

Default LLM provider is **`ollama`** ($0). Set `llm.provider: mock` for local testing without Ollama.

## Build & scripts

```bash
pnpm install              # single workspace install
pnpm run build            # turbo: shared → core → web → api → cli
pnpm test                 # all package tests
pnpm run typecheck        # all packages
pnpm run lint             # all packages
pnpm run dev:dashboard    # API on :3030 (tsx)
pnpm run dev:web          # Vite on :5173 (proxies /api → :3030)
```

Production entrypoints (after `pnpm run build`):

```bash
node apps/cli/dist/run.js --config config.yaml
node apps/cli/dist/dashboard.js --config config.yaml
```

## Pre-flight (Synology deploy)

```bash
uname -m   # NAS must be x86_64 for Playwright
curl http://<multimedia-ip>:11434/   # Ollama reachable from container
```

## Docker (production)

Multi-stage image uses `turbo prune --docker` + pnpm. Mount NAS volume at `/data` with `config.yaml`, `.env`, and SQLite:

```bash
docker compose build
docker compose run --rm scraper
docker compose up -d dashboard proxy
```

Schedule via Synology Task Scheduler:

| Job | Command | Interval |
|-----|---------|----------|
| Main scrape | `docker compose run --rm scraper` | 60 min |
| Poshmark | `docker compose run --rm poshmark` | 3 h |
| Web app | `docker compose up -d dashboard proxy` | always on (HTTPS via proxy) |
| Grafana | `docker compose up -d grafana` | always on (:3000) |
| Loki logs | `docker compose --profile loki up -d loki promtail` | optional (with Grafana) |

The web app has login + role-based access + DB-backed editable config, and is where alert feedback (👍/👎) is recorded. Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` to bootstrap the first owner. Full guide: [docs/web-app.md](docs/web-app.md).

## Stack (mid-2026)

| Area | Target |
| --- | --- |
| Node | ≥ 24 LTS (Docker `node:24-bookworm`) |
| TypeScript | 6.0 (NodeNext backend, bundler SPA) |
| Zod | 4.4 (shared across api + web) |
| Vitest / ESLint | 4.x / 10.x |
| Playwright | 1.52.x (+ stealth pilot doc) |
| better-sqlite3 | 12.x |
| Anthropic SDK | ~0.102 |
| Fastify | ≥ 5.8.5 |

## Tests

```bash
pnpm test                 # unit + integration (no network)
pnpm run test:coverage    # @fm/core coverage
pnpm run test:e2e         # Playwright DOM fixture regression
pnpm run verify:scrapers  # live scrape (see docs/SMOKE.md)
pnpm run test:live        # Vitest @live tag
pnpm run test:mutation    # Stryker on pipeline modules (slow)
```

## Analytics

Four ways to inspect runs, alerts, scores, and feedback: [docs/analytics.md](docs/analytics.md)

```bash
pnpm run dev:report
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=dev-pass pnpm run dev:dashboard
docker compose up -d dashboard proxy grafana
# optional centralized logs:
docker compose --profile loki up -d loki promtail
```

Structured logging and optional Loki: [docs/logging-and-audit.md](docs/logging-and-audit.md)

## Spec

Design docs: [spec/README.md](spec/README.md)

## Architecture decisions

7 ADRs in [`docs/adr/`](docs/adr/) covering MCP as the primary interface, encrypted-at-rest secrets, invite-only self-service profiles, tiered connections, multi-profile serial pipeline execution, shared-GPU inference broker, and ntfy over Telegram for push alerts.

## License

MIT — see [LICENSE](LICENSE).
