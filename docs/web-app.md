# Web app: auth, roles, and deployment

The web dashboard is a multi-user web app with two parts: a JSON API server built on Fastify, and a React SPA. The API lives in `@fm/api`; the SPA lives in `@fm/web`. Both share request and response contracts from `@fm/shared` — schemas written with Zod — so the SPA no longer needs to hand-copy DTOs.

The CLI pipeline (`@fm/cli` → `run.ts`) keeps working unchanged. It reads its config from the database, which is seeded from `config.yaml` the first time the app boots.

## Architecture (API + SPA)

- **API** (`packages/api`) — every route under `/api/*` returns JSON. It is protected by session-cookie auth, capability RBAC (`packages/api/src/web/context.ts`), and CSRF protection. Unauthenticated `/api/*` requests get `401 {"error":"unauthorized"}` — no redirects.
- **Auth/me** — `GET /api/me` returns the current user, their role, and their capabilities (the specific permission strings, like `analytics:read`, a role grants). The SPA hides controls it can't use, but **the server still enforces every capability independently** — don't rely on the SPA's hiding alone.
- **CSRF** — `GET /api/csrf` issues a token plus a signed cookie. The SPA echoes the token back via the `x-csrf-token` header on mutating requests.
- **SPA hosting** — `@fm/web#build` outputs `apps/web/dist`. `@fm/api#build` copies that bundle to `packages/api/dist/public`, and Fastify serves it. Hashed assets are cached; non-`/api/` GET requests fall back to `index.html` so client-side routing works.

Public API paths: `/api/health`, `/api/csrf`, `/api/login`, `/api/logout`.

Other key endpoints:

- `GET/POST/PATCH/DELETE /api/monitors`
- `GET/PUT /api/taste`
- `GET/PUT /api/system`
- `GET/PUT /api/secrets`
- `POST /api/secrets/trigger-run`
- `GET /api/users` (plus user role/status patches)
- `GET /api/dashboard`
- `GET /api/audit?limit=&offset=&category=&actor=&since=`
- `POST /api/feedback` — requires `feedback:write`; records 👍/👎 on an alert, copies title/brand/price/`source_query_id` from `alert_log`, and feeds the LLM prompt's few-shot examples

## SPA navigation (persona zones)

The nav is grouped by responsibility. The SPA hides items a user lacks the capability for, but the API still enforces access regardless of what the nav shows.

| Zone | Routes | Typical roles |
| --- | --- | --- |
| **Observe** | Analytics (`/`) | all roles with `analytics:read` |
| **Curator** | Monitors, Taste, Query performance | curator, admin, owner |
| **Operations** | System, Secrets & health, Audit | operator, admin, owner |
| **Admin** | Users | admin, owner |

**Role-based landing:** after login, TanStack Router (the SPA's client-side routing library) sends each user to a default route, based on `GET /api/me`:

| Role | Default route |
| --- | --- |
| viewer | `/` (analytics) |
| curator | `/monitors` |
| operator | `/system` |
| admin / owner | `/monitors` |

`/operations` redirects to `/system`, kept for bookmark compatibility.

## Telemetry tiers

Three distinct observability layers — keep them separate:

| Tier | Storage | API / UI | Who sees it |
| --- | --- | --- | --- |
| **Audit log** | `audit_log` table | `GET /api/audit` (filters: `limit`, `offset`, `category`, `actor`, `since`), Operations → Audit | `system:read` (operator+) |
| **Config revisions** | `config_revisions` | `GET /api/dashboard` → config revisions section | `analytics:read` (curator analytics) |
| **Ops telemetry** | `integration_events` + views | `GET /api/secrets` (uptime/failures), Secrets & health tab; stripped from dashboard for users without `secrets:read` | operator+ only |

Audit records *who changed what* (login, monitor edits, secret upserts). Config revisions snapshot *what config looked like* at each change. Integration events record *external dependency health* (scrapers, LLM, ntfy — the push-notification service used for alerts).

See [logging-and-audit.md](./logging-and-audit.md) for structured stdout logs (Pino), event id conventions, redaction, and the full audit action list.

## Development

Run the API and the SPA dev server in two terminals:

```bash
# Terminal 1 — backend JSON API on :3030
pnpm run dev:dashboard -- --config config.yaml

# Terminal 2 — Vite dev server on :5173 (proxies /api → :3030)
pnpm run dev:web
```

Or build everything into one production-like origin:

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

This applies idempotently on every boot. Create more users from the **Users** page after first login.

### Env vars (see `.env.example`)

| Variable | Purpose |
| --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Bootstrap owner account |
| `SESSION_SECRET` | Cookie signing (≥ 16 chars; stable across restarts in prod) |
| `SECRETS_KEY` | 64-char hex — encrypts secrets at rest in SQLite |
| `COOKIE_SECURE` | `true` behind TLS (docker-compose sets this for dashboard) |
| `NTFY_TOKEN` | Alert delivery auth, if the ntfy topic requires it (also editable in UI secrets) |
| `ANTHROPIC_API_KEY` | Optional Claude provider |
| `EBAY_*` / `GRAILED_*` | Platform credentials |

## Roles & capabilities

Roles and their capabilities are defined in `@fm/shared/rbac.ts` and enforced in `@fm/api` via `requireCapability`. Each role — owner, admin, curator, operator, or viewer — bundles a fixed set of capabilities. At least one owner per profile is protected from demotion.

## Docker

`docker-compose.yml` runs `node apps/cli/dist/dashboard.js` inside the image built via `turbo prune` plus pnpm. The dashboard is exposed directly on its host port — no bundled TLS-terminating proxy in front of it — so `COOKIE_SECURE` defaults to `false`.

## Search groups vs pipeline aggregation

Curators manage **search groups** on the Monitors page (`GET/POST/PATCH/DELETE /api/monitors`) — the UI nav calls this same feature "Monitors." Each group is one logical monitor with a shared `query_text`, selected `platforms[]`, and optional per-platform `query_overrides`.

On create/update the API syncs **execution rows** in `scrape_queries` with ids `{groupId}@{platform}` (e.g. `corduroy-jacket@depop`). The pipeline still reads `scrape_queries` and runs `scrapeAll` unchanged.

**Lineage:** listings, alerts, and feedback use `source_query_id` = **group id**, so quality metrics roll up at the group level. Per-platform scrape stats remain in `scrape_query_runs`, keyed by execution id (and `group_id`).

**API shape:** `GET /api/monitors` returns `{ groups, platforms, statuses, canWrite }`. POST/PATCH/DELETE operate on search groups only.

**Analytics:** `GET /api/dashboard` includes `groupScorecard` (rollup) plus `queryScorecard` (per-execution drill-down). Query performance links use the group id.

## Shared types in the SPA

Import DTOs and form schemas from `@fm/shared`:

```typescript
import type { DashboardPayload, SearchGroup } from "@fm/shared/dto.js";
import { SearchGroupCreateInputSchema } from "@fm/shared/schemas/search-groups.js";
```

`vinted` stays in the canonical `PLATFORMS` list even though it has no scraper implementation yet — the registry returns a stub for it. Keeping one source of truth here stops the UI and backend from drifting apart.
