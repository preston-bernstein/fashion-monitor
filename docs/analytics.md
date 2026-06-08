# Analytics & dashboards

Fashion Monitor stores all operational data in SQLite. Four ways to view it:

| Option | Best for |
|--------|----------|
| **SQL views** | Ad-hoc exploration in [DB Browser for SQLite](https://sqlitebrowser.org/) |
| **CLI report** | Quick terminal summary after a run or via cron |
| **Web dashboard** | Local browsable UI with auto-refresh |
| **Grafana** | Charts, history, Synology-friendly monitoring |

Views are created automatically on DB open (migration `003_analytics_views.sql`).

---

## 1. SQL views (DB Browser)

Open your database (default `data/fashion_monitor.db`). After at least one pipeline run, the **Browse Data** tab lists these views:

| View | Contents |
|------|----------|
| `v_run_summary` | Runs with duration, counts, errors |
| `v_recent_alerts` | All alerts, newest first |
| `v_score_by_platform` | YES/MAYBE/NO/PENDING counts per platform |
| `v_feedback_summary` | Positive vs negative feedback |
| `v_daily_runs` | Daily aggregates |
| `v_seen_listings_enriched` | Seen listings + alerted flag |
| `v_platform_alert_totals` | Alert counts and avg price by platform |
| `v_integration_uptime_7d` | Per-integration uptime % (scrapers, LLM, Telegram) |
| `v_integration_recent_failures` | Fail/degraded events, newest first |
| `v_integration_daily` | Daily problem counts by integration |

Example queries:

```sql
SELECT * FROM v_run_summary ORDER BY id DESC LIMIT 10;
SELECT * FROM v_daily_runs ORDER BY run_date DESC;
SELECT * FROM v_score_by_platform WHERE profile_id = 'default';
```

**Tip:** File → Export → table/view to CSV for spreadsheets.

---

## 2. CLI report

```bash
npm run dev:report -- --config config.yaml
# optional: --days 30 for daily section
```

Docker:

```bash
docker compose run --rm dashboard-report
```

Prints overview, daily activity, recent runs, scores, alerts, **integration uptime (7d)**, and recent failures.

---

## Integration health

Every pipeline run records connectivity checks to `integration_events`:

| Integration key | When recorded |
|-----------------|---------------|
| `scraper:{platform}` | After each platform scrape (ok / degraded / fail) |
| `scraper:{platform}:{queryId}` | Per-query failure when scrape is partial or failed |
| `llm:{provider}` | LLM health check before scoring |
| `alerts:telegram` | Each alert digest/send/empty-notice attempt |
| `feedback:telegram` | Each feedback-bot poll (when that process is running) |
| `pipeline:run` | Uncaught pipeline error |

**CLI report:** sections *Integration uptime (7d)* and *Recent integration failures*.

**Web SPA:** integration health appears only under Operations → Secrets & health (not on curator Analytics).

Example SQL:

```sql
SELECT * FROM v_integration_uptime_7d WHERE profile_id = 'default';
SELECT * FROM v_integration_recent_failures WHERE profile_id = 'default' LIMIT 20;
```

Events older than 30 days are pruned automatically (same window as run history).

---

## 3. Web dashboard

Authenticated React SPA on port **3030** (auto-refreshes every 60s). Session cookies + capability RBAC — see [web-app.md](./web-app.md).

```bash
pnpm run dev:dashboard -- --config config.yaml
pnpm run dev:web   # Vite dev server proxies /api
# open http://127.0.0.1:5173/ (dev) or http://127.0.0.1:3030/ (production build)
```

Docker (always-on):

```bash
docker compose up -d dashboard
# http://<host>:3030/
```

Options:

| Flag / env | Default | Purpose |
|------------|---------|---------|
| `--host` / `DASHBOARD_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker) |
| `--port` / `DASHBOARD_PORT` | `3030` | HTTP port |

**Security:** Multi-user auth with roles. Bind to localhost on dev machines; in production use TLS (Caddy in docker-compose), strong passwords, and do not expose the service without auth.

API: `GET /api/dashboard` returns JSON payload. Integration health fields are omitted for users without `secrets:read`.

### Telemetry tiers (web UI)

| Tier | What it tracks | Where in UI | Capability |
|------|----------------|-------------|------------|
| **Audit log** | User actions (login, config edits, secret changes) | Operations → Audit | `system:read` |
| **Config revisions** | Snapshots of taste/system/monitors after each change | Analytics → Config revisions | `analytics:read` |
| **Ops telemetry** | Scraper/LLM/Telegram health (`integration_events`) | Operations → Secrets & health | `secrets:read` |

Curator-facing **Query performance** (`/query-performance`) shows `v_query_scorecard` and `v_query_run_history` from the dashboard payload.

### Query quality metrics (scorecard)

Migration `011_query_scorecard_quality.sql` extends `v_query_scorecard` with curator-facing quality fields:

| Field | Meaning |
|-------|---------|
| `scored_yes` | Listings scored YES across all runs |
| `yes_rate` | YES / (YES + MAYBE + NO) |
| `alert_rate` | Alerts / new listings |
| `feedback_positive` / `feedback_negative` | Telegram feedback tied to `source_query_id` |
| `feedback_ratio` | Positive / (positive + negative) |
| `last_alert_at` | Most recent alert for this query |
| `last_good_signal_at` | Latest alert or positive feedback timestamp |

**Web UI:** Curator → Query performance table shows alert rate, feedback ratio, YES count, last signal, and a green/yellow/red quality hint (tooltip documents thresholds). Analytics → Recent alerts links `source_query_id` to query performance; negative prompt-diet examples include a **Revise query** link to Monitors (`?edit=<query_id>`).

**API:** `GET /api/dashboard` → `queryScorecard[]` and `alerts[].source_query_id`.

---

## 4. Grafana

Pre-provisioned SQLite datasource + dashboard.

```bash
# Ensure DB exists at ./data/fashion_monitor.db (matches config.yaml database.path)
docker compose up -d grafana
```

Open **http://localhost:3000** — login `admin` / password from `GRAFANA_ADMIN_PASSWORD` (default `fashion` in compose).

- **Datasource:** Fashion Monitor SQLite → `/data/fashion_monitor.db`
- **Dashboard:** Fashion Monitor folder → *Fashion Monitor*

Requires plugin `frser-sqlite-datasource` (installed automatically on container start).

**Note:** Grafana reads the DB file read-only from the mounted `./data` volume. If your `config.yaml` uses a different DB path, either:

- Symlink/copy to `data/fashion_monitor.db`, or
- Edit `grafana/provisioning/datasources/sqlite.yml` `jsonData.path`

---

## Docker services summary

```bash
docker compose up -d dashboard grafana feedback-bot
```

| Service | Port | Role |
|---------|------|------|
| `dashboard` | 3030 | Web analytics UI |
| `grafana` | 3000 | Charts & history |
| `dashboard-report` | — | One-shot CLI report (`docker compose run --rm dashboard-report`) |

---

## Data model reference

Raw tables (for custom SQL):

- `runs` — pipeline run stats
- `seen_listings` — dedupe + scores
- `alert_log` — sent alerts
- `feedback` — Telegram button feedback

## Search intelligence (phase 1)

See [spec/07-search-intelligence.md](../spec/07-search-intelligence.md).

- **`searches`** in `config.yaml` — stable query ids + text; defaults if omitted
- **`v_query_scorecard`** — which searches produce alerts and +/− feedback
- **`v_query_run_history`** — per-run query performance timeline
- **`config_revisions`** — when aesthetic / search wording changed
- Dashboard sections: **Config revisions**, **Prompt diet** (curator Analytics)
- **Query performance** page: **Search scorecard**, **Query run history**

Mark a query for rewrite: `status: needs_revision` + optional `note` in config.
