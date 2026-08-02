# Analytics & dashboards

Fashion Monitor stores everything it collects — pipeline runs, scores, alerts, feedback — in one SQLite database. This doc covers four ways to look at that data:

| Option | Best for |
|--------|----------|
| **SQL views** | Ad-hoc exploration in [DB Browser for SQLite](https://sqlitebrowser.org/) |
| **CLI report** | Quick terminal summary after a run or via cron |
| **Web dashboard** | Local browsable UI with auto-refresh |
| **Grafana** | Charts, history, Synology-friendly monitoring |

A migration script, `003_analytics_views.sql`, creates the SQL views below automatically the first time you open the database.

---

## 1. SQL views (DB Browser)

Open your database (default path `data/fashion_monitor.db`). After the pipeline has run at least once, check the **Browse Data** tab in DB Browser for SQLite (a free desktop app for browsing SQLite files) — it lists these views:

| View | Contents |
|------|----------|
| `v_run_summary` | Runs with duration, counts, errors |
| `v_recent_alerts` | All alerts, newest first |
| `v_score_by_platform` | YES/MAYBE/NO/PENDING counts per platform |
| `v_feedback_summary` | Positive vs negative feedback |
| `v_daily_runs` | Daily aggregates |
| `v_seen_listings_enriched` | Seen listings + alerted flag |
| `v_platform_alert_totals` | Alert counts and avg price by platform |
| `v_integration_uptime_7d` | Per-integration uptime % (scrapers, LLM, ntfy) |
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

Run this for a quick terminal summary:

```bash
pnpm run dev:report -- --config config.yaml
# optional: --days 30 for daily section
```

Or run it in Docker:

```bash
docker compose run --rm dashboard-report
```

It prints an overview, daily activity, recent runs, scores, alerts, integration uptime for the last 7 days, and recent failures.

---

## Integration health

Every pipeline run checks the health of each external dependency — the scrapers, the LLM, and ntfy (the push-notification service Fashion Monitor uses to deliver alerts) — and logs the result to the `integration_events` table.

| Integration key | When recorded |
|-----------------|---------------|
| `scraper:{platform}` | After each platform scrape (ok / degraded / fail) |
| `scraper:{platform}:{queryId}` | Per-query failure when scrape is partial or failed |
| `llm:{provider}` | LLM health check before scoring |
| `alerts:ntfy` | Each alert digest/send/empty-notice attempt |
| `pipeline:run` | Uncaught pipeline error |

**CLI report:** shows this under the *Integration uptime (7d)* and *Recent integration failures* sections.

**Web SPA:** integration health appears only under Operations → Secrets & health, not on the curator's Analytics page. (Curator is one of five user roles — see [web-app.md](./web-app.md) for the full list.)

Example SQL:

```sql
SELECT * FROM v_integration_uptime_7d WHERE profile_id = 'default';
SELECT * FROM v_integration_recent_failures WHERE profile_id = 'default' LIMIT 20;
```

Events older than 30 days are pruned automatically — the same window used for run history.

---

## 3. Web dashboard

The web dashboard is that same SPA, served on port **3030**. It auto-refreshes every 60 seconds and requires login: session cookies plus RBAC. See [web-app.md](./web-app.md) for how login and roles work.

```bash
pnpm run dev:dashboard -- --config config.yaml
pnpm run dev:web   # Vite dev server proxies /api
# open http://127.0.0.1:5173/ (dev) or http://127.0.0.1:3030/ (production build)
```

Run it always-on with Docker:

```bash
docker compose up -d dashboard
# http://<host>:3030/
```

Options:

| Flag / env | Default | Purpose |
|------------|---------|---------|
| `--host` / `DASHBOARD_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker) |
| `--port` / `DASHBOARD_PORT` | `3030` | HTTP port |

**Security:** The dashboard supports multiple users, each with a role. Bind it to localhost on dev machines. In production, use TLS (the docker-compose file includes a Caddy service for this), use strong passwords, and never expose the service without auth.

The `GET /api/dashboard` endpoint returns the dashboard's JSON payload. It omits integration-health fields for users without the `secrets:read` permission.

### Telemetry tiers (web UI)

| Tier | What it tracks | Where in UI | Capability |
|------|----------------|-------------|------------|
| **Audit log** | User actions (login, config edits, secret changes) | Operations → Audit | `system:read` |
| **Config revisions** | Snapshots of taste/system/monitors after each change | Analytics → Config revisions | `analytics:read` |
| **Ops telemetry** | Scraper/LLM/ntfy health (`integration_events`) | Operations → Secrets & health | `secrets:read` |

The curator-facing **Query performance** page (`/query-performance`) shows `v_query_scorecard` and `v_query_run_history` from the dashboard payload.

### Query quality metrics (scorecard)

A migration, `011_query_scorecard_quality.sql`, adds curator-facing quality fields to `v_query_scorecard`:

| Field | Meaning |
|-------|---------|
| `scored_yes` | Listings scored YES across all runs |
| `yes_rate` | YES / (YES + MAYBE + NO) |
| `alert_rate` | Alerts / new listings |
| `feedback_positive` / `feedback_negative` | Dashboard feedback tied to `source_query_id` |
| `feedback_ratio` | Positive / (positive + negative) |
| `last_alert_at` | Most recent alert for this query |
| `last_good_signal_at` | Latest alert or positive feedback timestamp |

**Web UI:** the Curator → Query performance table shows alert rate, feedback ratio, YES count, last signal, and a green/yellow/red quality hint (hover the tooltip for the thresholds). On Analytics → Recent alerts, each `source_query_id` links to query performance; negative prompt-diet examples include a **Revise query** link to Monitors (`?edit=<query_id>`).

**API:** `GET /api/dashboard` returns this as `queryScorecard[]`, with each alert's `source_query_id` under `alerts[]`.

---

## 4. Grafana

The repo ships Grafana pre-configured with a SQLite data source and a starter dashboard.

```bash
# Ensure DB exists at ./data/fashion_monitor.db (matches config.yaml database.path)
docker compose up -d grafana
```

Open **http://localhost:3000** and log in with username `admin` and the password from `GRAFANA_ADMIN_PASSWORD` (default `fashion` in compose).

- **Datasource:** Fashion Monitor SQLite → `/data/fashion_monitor.db`
- **Dashboard:** Fashion Monitor folder → *Fashion Monitor*

This needs the `frser-sqlite-datasource` plugin, which installs automatically when the container starts.

**Note:** Grafana reads the database file read-only from the mounted `./data` volume. If your `config.yaml` uses a different database path, either:

- Symlink or copy it to `data/fashion_monitor.db`, or
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

Raw tables for custom SQL:

- `runs` — pipeline run stats
- `seen_listings` — dedupe + scores
- `alert_log` — sent alerts
- `feedback` — dashboard thumbs up/down feedback

## Search intelligence (phase 1)

See [spec/07-search-intelligence.md](../spec/07-search-intelligence.md) for the full design.

- **`searches`** in `config.yaml` — stable query ids and text; the app supplies defaults if this is omitted
- **`v_query_scorecard`** — which searches produce alerts and positive/negative feedback
- **`v_query_run_history`** — per-run query performance timeline
- **`config_revisions`** — records when the taste profile or search wording changed
- Dashboard sections: **Config revisions**, **Prompt diet** (curator Analytics)
- **Query performance** page: **Search scorecard**, **Query run history**

To mark a query for rewrite, set `status: needs_revision` (with an optional `note`) in config.
