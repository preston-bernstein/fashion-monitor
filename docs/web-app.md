# Web app: auth, roles, and deployment

The dashboard is a multi-user web app split into a **Fastify JSON API** (`@fm/api`) and a **React SPA** (`@fm/web`). Shared request/response contracts live in `@fm/shared` (Zod schemas + inferred types) — the SPA no longer mirrors DTOs by hand.

The CLI pipeline (`@fm/cli` → `run.ts`) keeps working unchanged — it reads config from the database, seeded from `config.yaml` on first boot.

## Architecture (API + SPA)

- **API** (`packages/api`) — every route under `/api/*` returns JSON. Session-cookie auth, capability RBAC (`packages/api/src/web/context.ts`), and CSRF protection. Unauthenticated `/api/*` requests get `401 {"error":"unauthorized"}` (no redirects).
- **Auth/me** — `GET /api/me` returns user, role, and capabilities. The SPA hides controls it cannot use; **the server still enforces every capability**.
- **CSRF** — `GET /api/csrf` issues a token (+ signed cookie). The SPA echoes it via `x-csrf-token` on mutating requests.
- **SPA hosting** — `@fm/web#build` outputs `apps/web/dist`. `@fm/api#build` copies that bundle to `packages/api/dist/public` and Fastify serves it. Hashed assets are cached; non-`/api/` GETs fall back to `index.html` for client routing.

Public API paths: `/api/health`, `/api/csrf`, `/api/login`, `/api/logout`.

Key endpoints: `GET/POST/PATCH/DELETE /api/monitors`, `GET/PUT /api/taste`, `GET/PUT /api/system`, `GET/PUT /api/secrets`, `POST /api/secrets/trigger-run`, `GET /api/users` + user role/status patches, `GET /api/dashboard`, `GET /api/audit?limit=&offset=&category=&actor=&since=`.

## SPA navigation (persona zones)

The nav is grouped by responsibility. Items are hidden when the user lacks the required capability; the API still enforces access.

| Zone | Routes | Typical roles |
| --- | --- | --- |
| **Observe** | Analytics (`/`) | all roles with `analytics:read` |
| **Curator** | Monitors, Taste, Query performance | curator, admin, owner |
| **Operations** | System, Secrets & health, Audit | operator, admin, owner |
| **Admin** | Users | admin, owner |

**Role-based landing** after login (TanStack Router + `/api/me`):

| Role | Default route |
| --- | --- |
| viewer | `/` (analytics) |
| curator | `/monitors` |
| operator | `/system` |
| admin / owner | `/monitors` |

`/operations` redirects to `/system` for bookmark compatibility.

## Telemetry tiers

Three distinct observability layers — do not conflate them:

| Tier | Storage | API / UI | Who sees it |
| --- | --- | --- | --- |
| **Audit log** | `audit_log` table | `GET /api/audit` (filters: `limit`, `offset`, `category`, `actor`, `since`), Operations → Audit | `system:read` (operator+) |
| **Config revisions** | `config_revisions` | `GET /api/dashboard` → config revisions section | `analytics:read` (curator analytics) |
| **Ops telemetry** | `integration_events` + views | `GET /api/secrets` (uptime/failures), Secrets & health tab; stripped from dashboard for users without `secrets:read` | operator+ only |

Audit records *who changed what* (login, monitor edits, secret upserts). Config revisions snapshot *what config looked like* at each change. Integration events record *external dependency health* (scrapers, LLM, Telegram).

See [logging-and-audit.md](./logging-and-audit.md) for structured stdout logs (Pino), event id conventions, redaction, and the full audit action list.

## Development

```bash
# Terminal 1 — backend JSON API on :3030
pnpm run dev:dashboard -- --config config.yaml

# Terminal 2 — Vite dev server on :5173 (proxies /api → :3030)
pnpm run dev:web
```

Or build everything for a production-like single origin:

```bash
pnpm run build
node apps/cli/dist/dashboard.js --config config.yaml
# → http://127.0.0.1:3030/ serves SPA + API
```

## First-boot admin

The app refuses to start with no admin. Bootstrap the first owner from env:

```
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=a-long-passphrase
```

Applied idempotently on every boot. Create more users from the **Users** page after first login.

### Env vars (see `.env.example`)

| Variable | Purpose |
| --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Bootstrap owner account |
| `SESSION_SECRET` | Cookie signing (≥ 16 chars; stable across restarts in prod) |
| `SECRETS_KEY` | 64-char hex — encrypts secrets at rest in SQLite |
| `COOKIE_SECURE` | `true` behind TLS (docker-compose sets this for dashboard) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alert delivery (also editable in UI secrets) |
| `ANTHROPIC_API_KEY` | Optional Claude provider |
| `EBAY_*` / `GRAILED_*` | Platform credentials |

## Roles & capabilities

Defined in `@fm/shared/rbac.ts`; enforced in `@fm/api` via `requireCapability`. Roles bundle capabilities (owner/admin/curator/operator/viewer). At least one owner per profile is protected from demotion.

## Docker

`docker-compose.yml` runs `node apps/cli/dist/dashboard.js` inside the image built via `turbo prune` + pnpm. Caddy (`proxy` service) terminates TLS; **Caddyfile unchanged**.

## Search groups vs pipeline aggregation

Curators manage **search groups** on the Monitors page (`GET/POST/PATCH/DELETE /api/monitors`). Each group is one logical monitor with a shared `query_text`, selected `platforms[]`, and optional per-platform `query_overrides`.

On create/update the API syncs **execution rows** in `scrape_queries` with ids `{groupId}@{platform}` (e.g. `corduroy-jacket@depop`). The pipeline still reads `scrape_queries` and runs `scrapeAll` unchanged.

**Lineage:** listings, alerts, and feedback use `source_query_id` = **group id** so quality metrics roll up at the group level. Per-platform scrape stats remain in `scrape_query_runs` keyed by execution id (and `group_id`).

**API shape:** `GET /api/monitors` returns `{ groups, platforms, statuses, canWrite }`. POST/PATCH/DELETE operate on search groups only.

**Analytics:** `GET /api/dashboard` includes `groupScorecard` (rollup) plus `queryScorecard` (per-execution drill-down). Query performance links use the group id.

## Shared types in the SPA

Import DTOs and form schemas from `@fm/shared`:

```typescript
import type { DashboardPayload, SearchGroup } from "@fm/shared/dto.js";
import { SearchGroupCreateInputSchema } from "@fm/shared/schemas/search-groups.js";
```

`vinted` remains in the canonical `PLATFORMS` list but has no scraper implementation yet (registry returns a stub) — one source of truth prevents UI/backend drift.
