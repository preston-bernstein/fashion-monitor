---
name: fashion-monitor-diagnostics-and-tooling
description: How to MEASURE fashion-monitor behavior instead of eyeballing it — the Pino log-event registry with jq filters, the SQLite analytics views (run funnel, Monitor scorecard, integration uptime, prompt diet), the report CLI, Grafana/Loki, and ready-to-run read-only scripts in this skill's scripts/ dir. Load when you need numbers: run funnels, PENDING backlog, per-Monitor performance, scraper/LLM/alert dependency health, or feedback-diet status. Do NOT load for deciding what a symptom means (fashion-monitor-debugging-playbook), test evidence (fashion-monitor-validation-and-qa), or experiment design (fashion-monitor-research-methodology).
---

# Diagnostics and Tooling (fashion-monitor)

Verified 2026-07-02. Rule of the house: never say "looks fine" — produce a number from one of the surfaces below.

## Shipped scripts (this skill's `scripts/` dir — all read-only, `sqlite3 -readonly`)

All take `[db_path]` (default `data/fashion_monitor.db`); run from repo root. **All five executed successfully against the local dev DB on 2026-07-02.**

| Script | Answers | Healthy shape |
|---|---|---|
| `funnel.sh [db] [n]` | last N runs: found → new → yes/maybe/no → alerted, duration, error flag | rows present, `err`=0, `new` > 0 on active hours; empty output = no completed runs in this DB |
| `pending-backlog.sh` | PENDING listings per profile/platform + oldest | `total_pending=0`; sustained growth = LLM unreachable (see debugging-playbook) |
| `scorecard.sh` | `v_search_group_scorecard` rollup + worst-20 per-platform `v_query_scorecard` | every active Monitor accruing runs; chronic `yes_rate` 0 with high `listings_new` → Monitor needs revision |
| `integration-health.sh` | `v_integration_uptime_7d` + `v_integration_recent_failures` | uptime ~100% per integration; clustered failures name the sick dependency |
| `feedback-diet.sh` | feedback counts + the 30 newest rows the prompt can draw from | as of 2026-07-02 this is EMPTY (feedback ingestion severed — expected until the alerting campaign lands) |
| `needs-revision.sh [db] [min_runs] [min_new] [max_yes_rate]` | `v_query_scorecard` rows with enough history/volume to judge (defaults: >=5 runs, >=10 new listings) and a yes_rate at or below the threshold (default 0.15, NULL counts as failing) | F2 (query-generation intelligence) step 1 — report only, never mutates `scrape_queries`/`search_groups`; empty output = no query currently needs revision |

## Log events (`packages/core/src/lib/log-events.ts` — the registry of record)

Structured Pino JSON on stdout; every line has an event id. Key ids:

- Pipeline: `pipeline.run.start|complete|failed`, `pipeline.prefilter.rejected`, `pipeline.llm.unavailable`, `pipeline.pending.backlog`, `pipeline.scorer.batch.start`, `pipeline.scorer.vision.start`, `pipeline.integration.recorded`
- Platforms: `platform.scrape.success|failed`, `platform.query.success|failed`, `platform.depop.rsc.success`, `platform.depop.http.failed`, `platform.ebay.oauth.failed`, `platform.grailed.credentials.valid`, `platform.vestiaire.fetch.blocked`
- Alerts: `alerts.send.failed`, `alerts.send.error`
- Web: `web.auth.login|login.failed|logout`, `web.request.complete`, `web.auth.csrf.failed`
- CLI: `cli.startup`, `cli.config.loaded|missing`, `cli.run.complete|failed`, `cli.dashboard.started|failed`, `cli.feedback-bot.*`, `cli.report.complete`

jq filters (pipe a run's stdout or `docker compose logs --no-log-prefix scraper`):

```bash
jq -r 'select(.event=="platform.scrape.failed") | [.platform,.msg] | @tsv'
jq -r 'select(.event|startswith("pipeline.")) | [.time,.event] | @tsv'
jq 'select(.event=="pipeline.llm.unavailable")'
```

`LOG_LEVEL` env sets verbosity (`debug|info|warn|error`). Redaction and audit-action list: `docs/logging-and-audit.md`.

## SQLite surfaces (schema of record: `packages/core/src/storage/migrations/`)

Views (migration that defines the current version): `v_run_summary`, `v_recent_alerts`, `v_score_by_platform`, `v_feedback_summary`, `v_daily_runs`, `v_seen_listings_enriched`, `v_platform_alert_totals` (003); `v_query_run_history`, `v_config_revision_timeline`, `v_prompt_diet_feedback` (005); `v_integration_uptime_7d`, `v_integration_recent_failures`, `v_integration_daily` (007); `v_query_scorecard` (**redefined in 005, 011, 012, 013 — the 013 version is live**); `v_search_group_scorecard` (013).

Funnel columns live on `runs` (`listings_found`, `listings_new`, `scored_yes/maybe/no`, `alerts_sent`, `error`) — note `runs` has **no profile_id column** as of 2026-07-02 (multi-profile gap; see fashion-monitor-multi-profile-campaign). Lineage: `seen_listings.score` (`YES|MAYBE|NO|PENDING`), `source_query_id` on `seen_listings`/`alert_log`/`feedback` traces every row back to its Monitor.

Ad-hoc queries: always `sqlite3 -readonly` (the pipeline may hold the WAL; never write from a shell).

## Other surfaces

| Surface | Command | Gives |
|---|---|---|
| Report CLI | `pnpm run dev:report -- --config config.yaml --days 14` | terminal rollup (runs, alerts, scores, feedback) |
| Web dashboard | `GET /api/dashboard` (auth'd) | scorecard, prompt diet, config timeline |
| Grafana | compose service, host port `${GRAFANA_PORT:-3001}` | sqlite-datasource dashboards from `grafana/dashboards/` |
| Loki | `docker compose --profile loki up -d loki promtail` | centralized log search (LogQL) |
| Live scraper check | `pnpm run verify:scrapers` | per-platform live pass/fail — real network + creds; use sparingly |

## When NOT to use this skill

- Interpreting a symptom / choosing next debug step → **fashion-monitor-debugging-playbook**
- What proof a change needs → **fashion-monitor-validation-and-qa**
- Designing before/after experiments on these numbers → **fashion-monitor-research-methodology**

## Provenance and maintenance

- Event registry drifted? `cat packages/core/src/lib/log-events.ts`
- View list: `grep -hn "CREATE VIEW" packages/core/src/storage/migrations/*.sql`
- Scripts still schema-valid: run each against a dev DB, e.g. `.claude/skills/fashion-monitor-diagnostics-and-tooling/scripts/funnel.sh data/fashion_monitor.db`
- `runs` still lacks profile_id: `grep -n "profile_id" packages/core/src/storage/migrations/001_init.sql` (absence under `runs` = gap persists)
- Grafana port: `grep -n GRAFANA_PORT docker-compose.yml`
