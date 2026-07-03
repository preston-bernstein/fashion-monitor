# Findings: F2 — Query-Generation Intelligence, Current Readiness

Date: 2026-07-03
Problem selected from `fashion-monitor-research-frontier`: **F2 — Query-generation intelligence** (spec/07 "Phase 2").
Method: read-only diagnostics only (`fashion-monitor-diagnostics-and-tooling` scripts + direct `sqlite3 -readonly` queries against `data/fashion_monitor.db`, plus targeted `grep` for code/spec readiness). No writes, no schema changes, no code changes.

## Headline finding

**F2's numeric "underperforming" definition cannot be evaluated yet — not because the mechanism is missing, but because zero scrape runs have ever been recorded against the reachable databases.** Every table `v_query_scorecard` and `v_search_group_scorecard` depend on is present, correctly wired, and returns exactly nine well-formed rows — all with `total_runs = 0`. This is a readiness gap, not a design gap: the actuation surface the frontier doc describes exists in full; the run history it needs doesn't exist anywhere I could query.

## What I ran

```
bash .claude/skills/fashion-monitor-diagnostics-and-tooling/scripts/scorecard.sh data/fashion_monitor.db
bash .claude/skills/fashion-monitor-diagnostics-and-tooling/scripts/funnel.sh data/fashion_monitor.db 20
bash .claude/skills/fashion-monitor-diagnostics-and-tooling/scripts/integration-health.sh data/fashion_monitor.db
bash .claude/skills/fashion-monitor-diagnostics-and-tooling/scripts/pending-backlog.sh data/fashion_monitor.db
bash .claude/skills/fashion-monitor-diagnostics-and-tooling/scripts/feedback-diet.sh data/fashion_monitor.db
sqlite3 -readonly data/fashion_monitor.db "SELECT ... FROM runs / seen_listings / feedback / alert_log / integration_events / scrape_query_runs / config_revisions / search_groups / scrape_queries / profiles / users / sessions / audit_log"
```

I also checked whether a live deployment exists with real history: SSH'd to the NAS (`agent@10.0.0.250:/volume1/docker/fashion-monitor`) — `data/` there contains only a `.env` file, no `.db`, and `docker ps` shows no fashion-monitor containers running (only an unrelated `ntfy` container). No live or NAS-side data source exists beyond the local dev DB checked into this worktree's `data/` directory (itself untracked by git).

## Real numbers

**Row counts, local dev DB (`data/fashion_monitor.db`, last touched 2026-06-08; WAL churn from local dev/test activity only):**

| Table | Rows |
|---|---|
| `runs` | 0 |
| `seen_listings` | 0 |
| `feedback` | 0 |
| `alert_log` | 0 |
| `integration_events` | 0 |
| `scrape_query_runs` | 0 |
| `config_revisions` | 0 |
| `search_groups` | 9 |
| `scrape_queries` | 9 |
| `profiles` | 1 |
| `users` | 1 |
| `sessions` | 1 |
| `audit_log` | 2 |
| `listing_images` | 0 |

The only non-zero tables are setup/config tables and a single manual web login (1 session, 2 audit entries). `runs` has never been populated — the scraper pipeline has not executed end-to-end against this database.

**`v_search_group_scorecard` / `v_query_scorecard` (via `scorecard.sh`):** all 9 rows (1 per Monitor × platform, since each of the 9 `search_groups` currently maps 1:1 to a single `scrape_queries` row) return `total_runs=0, listings_found=0, listings_new=0, scored_yes/maybe/no=0, alerts_sent=0, alert_rate=NULL, yes_rate=NULL, feedback_positive=0, feedback_negative=0`. `funnel.sh`, `integration-health.sh`, and `feedback-diet.sh` all return empty result sets; `pending-backlog.sh` reports `total_pending=0`.

**Platform/query distribution (from `scrape_queries`):** 9 active queries across 6 platforms — ebay ×3, grailed ×2, depop/poshmark/vestiaire/vinted ×1 each. All `status='active'`.

**Query Override readiness:** `search_groups.query_overrides` (the per-platform replacement-query column F2 names as its actuation surface, added in migration `012_search_groups.sql`) is **NULL/empty on all 9 of 9 rows**. The A/B mechanism F2's step 3 proposes (sibling `scrape_queries` rows on the same Monitor) is schema-ready but currently unused — there are no override queries to compare against primaries.

**Code/spec readiness (grep, not runtime):**
- `v_query_scorecard` — live version confirmed at migration `013_unify_search_groups.sql:41`, columns match exactly what F2's step 1 needs (`listings_new`, `scored_yes/maybe/no`, `alerts_sent`, `feedback_positive/negative`) with `alert_rate` and `yes_rate` precomputed.
- `spec/07-search-intelligence.md:55` confirms Phase 2 (`needs_revision` auto-suggest) is explicitly "not yet" built — matches the frontier doc's framing.
- `packages/core/src/llm/mock.ts` exists (candidate for generating trial Query Overrides without live LLM calls in a report-only harness).

## What this means for F2's three steps

1. **"Define 'underperforming' numerically and implement `needs_revision` as a report."** The columns to define it on (`yes_rate`, `listings_new`, run counts) exist and are live in `v_query_scorecard` — this step is a pure SQL/reporting exercise today, no schema or pipeline work needed. But with `total_runs=0` everywhere, any threshold (e.g. `yes_rate < 0.05 AND listings_new > 20`) currently classifies **0 of 9** queries as evaluable, let alone underperforming — there's no signal to threshold against yet.
2. **"Generate candidate Query Overrides."** Blocked on step 1 producing a real underperforming set, which is blocked on run history.
3. **"A/B sibling queries, compare scorecards over ≥10 runs."** Requires `scrape_query_runs` rows; currently 0 rows against 9 configured queries, and `query_overrides` is unset on all 9 groups, so there is no sibling to A/B yet.

**Revised falsifiable milestone (unchanged core idea, sharper gate):** F2's original bar — "a generated override beats its primary query's yes_rate over ≥10 runs" — is sound but presupposes runs exist. The concrete prerequisite this diagnostic surfaces: **the pipeline needs to execute against this DB (or a DB reachable for analysis) at least once before F2 is measurable at all.** That's not an F2-specific gap — it's upstream of every frontier item.

## Cross-cutting observation (not scoped to F2)

The same zero-runtime-data condition blocks F1, F3, and F4 identically — `feedback` (F1's corpus), `integration_events` (F4's outcome record), and any MAYBE-verdict history (F3's flip-rate input) are all empty for the same reason: no run has ever completed against a reachable database. The research-frontier doc already flags F1's feedback corpus as "small" and F3 as "needs instrumentation first" — the more precise number, as of 2026-07-03, is **zero**, not small, and the same zero applies to F2 and F4's inputs too. Whichever frontier item is picked up next, "get one real pipeline run recorded somewhere queryable" is the shared unblocking step, ahead of any of the individually-cited gaps (feedback ingestion, vision-verdict persistence, driver-matrix scheduling).
