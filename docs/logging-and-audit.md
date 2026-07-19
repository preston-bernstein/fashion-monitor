# Logging and audit

Fashion Monitor uses three observability tiers. See also [web-app.md](./web-app.md#telemetry-tiers) for how they surface in the UI.

| Tier | Storage | Purpose |
| --- | --- | --- |
| **Audit log** | `audit_log` (SQLite) | Human-initiated or security-sensitive actions |
| **Config revisions** | `config_revisions` (SQLite) | Point-in-time config snapshots |
| **Ops telemetry** | `integration_events` + `runs` + `scrape_query_runs` | Machine pipeline health and run stats |

Structured **stdout JSON logs** (Pino) complement the database tiers with correlation IDs and debug detail. They are not the source of truth for dashboards.

## Structured logging

All server, pipeline, platform, and CLI code uses `@fm/core/lib/logging.ts` — a Pino-backed wrapper with stable event ids.

### Log line schema

Each line is one JSON object written to stdout:

```json
{
  "level": 30,
  "time": "2026-06-08T12:00:00.000Z",
  "scope": "pipeline.orchestrator",
  "event": "pipeline.run.complete",
  "runId": 42,
  "profileId": "default",
  "ctx": {
    "listingsFound": 120,
    "listingsNew": 8,
    "alertsSent": 2
  }
}
```

| Field | Meaning |
| --- | --- |
| `level` | Pino numeric level (10=trace, 20=debug, 30=info, 40=warn, 50=error) |
| `time` | ISO-8601 timestamp |
| `scope` | Logger scope (module/component), e.g. `web.request`, `platform.depop` |
| `event` | Stable dotted event id (`{area}.{subject}.{verb}`) |
| `ctx` | Non-correlation context (counts, errors, paths, etc.) |
| Correlation (top-level when present) | `profileId`, `runId`, `requestId`, `userId`, `integration`, `platform`, `queryId` |

Event id constants live in `packages/core/src/lib/log-events.ts` to prevent string drift. Backend packages (`core`, `api`, `cli`) lint against raw string event ids in `log.*` calls — use `LogEvents.*`.

### Configuration

```bash
LOG_LEVEL=info   # debug | info | warn | error (default: info; debug when NODE_ENV=development)
```

Set in `.env` or the process environment. Fastify shares the same root Pino instance; API requests get a `requestId` via `genReqId` (or `x-request-id` header).

### Redaction

`redactSecrets(obj)` redacts values whose keys match sensitive patterns (`password`, `token`, `secret`, `cookie`, `csrf`, `hash`, `api_key`, `authorization`, `encrypted`, `payload`). Use near auth and secrets routes; never log raw ntfy tokens, API keys, password hashes, or encrypted secret payloads. Depop's ScrapFly-tier error responses and any harvested Cloudflare cookie values (`__cf_bm`, `_cfuvid`, etc.) must go through this redaction as well; the existing `cookie` and `api_key` patterns already cover these cases.

### Pipeline correlation

`withRunContext(runId, fn)` and `log.child({ runId })` attach `runId` to orchestrator logs. Integration event recording also emits debug logs (`pipeline.integration.recorded`).

## Audit log

Append-only human/security actions queryable via `GET /api/audit` (`system:read`).

### Covered actions

| Action | Trigger |
| --- | --- |
| `login.success` | Valid credentials |
| `login.failed` | Invalid credentials |
| `logout` | User-initiated logout |
| `auth.forbidden` | Mutating request blocked by capability (POST/PUT/PATCH/DELETE only) |
| `auth.csrf.failed` | CSRF validation failure on mutating request |
| `system.bootstrap.admin` | First admin created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` |
| `search_group.create` / `search_group.update` / `search_group.delete` | Search group CRUD |
| `taste.update` | Taste profile save |
| `system.update` | System settings save |
| `secret.upsert` | Secret value stored (key only in `target`, never the value) |
| `pipeline.trigger` | Manual run requested from Secrets UI |
| `user.create` / `user.role` / `user.status` | User management |
| `feedback.record` | 👍/👎 recorded on an alert (`POST /api/feedback`) |

`detail` is JSON when structured context helps, e.g.:

```json
{
  "capability": "secrets:write",
  "path": "/api/secrets",
  "method": "PUT",
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Use `AuditLogRepo.recordFromRequest()` or `auditFromRequest()` in API routes.

### Not in audit_log

Keep these in `integration_events`, `runs`, or structured logs only:

- Per-platform scrape success/failure
- LLM health check results
- ntfy send results
- Pipeline run completion stats (authoritative in `runs`)
- Read-only API access (including GET 403)

## Log aggregation (optional)

Today logs go to **stdout** only. In Docker, capture container stdout. For centralized search, the repo ships an optional **Loki + Promtail** stack (FOSS) alongside Grafana 11.x.

### Running with Loki

Start Grafana (SQLite metrics) plus Loki log shipping:

```bash
docker compose up -d grafana dashboard proxy
docker compose --profile loki up -d loki promtail
```

Promtail uses Docker service discovery and scrapes JSON stdout from compose services labeled `fm.logging=true` (`scraper`, `poshmark`, `dashboard`). Loki is **not** published to the host — only Grafana and Promtail talk to it on the compose network.

**Security:** Loki runs with `auth_enabled: false`. Do not expose port 3100 publicly without a reverse proxy and authentication. Grafana on `:3000` should stay on a trusted network; change `GRAFANA_ADMIN_PASSWORD`.

Grafana provisions:

- **Fashion Monitor SQLite** — run/score metrics (default)
- **Fashion Monitor Loki** — structured stdout logs
- **Fashion Monitor Logs** dashboard — starter LogQL panels

### Example LogQL queries

Open **Explore → Loki** or the **Fashion Monitor Logs** dashboard.

| Query | Use |
| --- | --- |
| `{event="pipeline.run.failed"}` | Failed pipeline runs |
| `{scope=~"platform.*"} \|= "error"` | Platform-layer errors |
| `{runId="42"}` | Correlate one pipeline run |
| `{requestId="550e8400-e29b-41d4-a716-446655440000"}` | One API request |
| `{service="dashboard"} \| json \| event="web.request.complete"` | Dashboard HTTP traffic |
| `{event="platform.query.failed"} \| json \| platform="ebay"` | eBay query failures |
| `{event="pipeline.scorer.vision.flip"} \| json \| flipped="true"` | MAYBE verdicts vision changed (see fashion-monitor-research-frontier F3) |

Structured fields (`event`, `scope`, `runId`, `requestId`, etc.) are parsed from Pino JSON lines when possible; filter by label or use `| json` in LogQL for fields inside the log line.

### Error fields in logs

When code passes an `Error` (or string `error`) in log context, the logger emits Pino-friendly `ctx.err: { type, message, stack? }`. Use `logError(logger, event, err, extra?)` for consistent error logs.
