# 07 — Search intelligence (phase 1)

Track **what** we search, **how** each Monitor performs, **what** feeds the scorer (+/−), and **when** config wording changed.

## Concepts

| Concept | Meaning |
|---------|---------|
| **Monitor** | A saved search (in `search_groups`) that fans out across one or more platforms. Primary query + optional per-platform Query Overrides. Canonical term — avoid "Search Group", "Search Query", "Saved Search". |
| **scrape_query** | A per-platform execution row derived from a Monitor. One Monitor with 3 platforms produces 3 scrape_queries per run. |
| **Query run** | One scrape_query executed inside one pipeline `runs` row |
| **Config revision** | Snapshot of aesthetic + rules + Monitors when hash changes |
| **Prompt diet** | Static Taste config + last 15 positive / 15 negative `feedback` rows |

## Monitors in the DB

Monitors are stored in `search_groups` (see 03-data-model.md). Each Monitor has:
- `query_text` — primary query sent to all platforms
- `platforms` — JSON array of platform strings
- `query_overrides` — JSON object with per-platform replacement queries (Query Override)
- `status` — `active` | `needs_revision` | `paused`
- `note` — optional curator note

Monitors are managed through the web UI (Curator role) or MCP server. The legacy `searches` block in `config.yaml` bootstraps initial scrape_queries but the DB is authoritative once Monitors exist. See CONTEXT.md § Default Searches.

Example Monitor (as it would appear in the web UI / MCP):
```
Monitor: "dark corduroy overshirt jacket"
Platforms: ebay, grailed, depop, poshmark
Query Overrides:
  ebay: "men jacket corduroy charcoal black XXL"
Status: active
Note: "broad query works on grailed; eBay needs explicit size"
```

## Tables

- `search_groups` — Monitor registry (primary query, platforms, overrides, status)
- `scrape_queries` — per-platform execution rows derived from Monitors
- `scrape_query_runs` — per-run stats: found, new, scored, alerts, errors
- `config_revisions` — JSON snapshot + hash when Taste or Monitor wording changes
- `source_query_id` on `seen_listings`, `alert_log`, `feedback` — lineage back to Monitor

## "Good Monitor" scorecard (phase 1 metrics)

Aggregated in `v_search_group_scorecard` (Monitor rollup) and `v_query_scorecard` (per-platform breakdown):

- `total_runs`, `listings_found`, `listings_new`, `alerts_sent`
- `feedback_positive`, `feedback_negative` (via join on `source_query_id`)
- `alert_rate` = alerts / nullif(new, 0)
- `yes_rate` = yes / (yes + maybe + no)
- `feedback_ratio` = positive / (positive + negative)
- `last_alert_at`, `last_good_signal_at`

Phase 2 (not yet): explicit "mark Monitor good/bad", auto-suggest `needs_revision`.

## UI

- CLI report + web dashboard: **Monitor scorecard**, **Prompt diet**, **Config timeline**
- Web UI allows Curators to add/edit/pause Monitors without touching config files
- Grafana: query panels (optional follow-up)
