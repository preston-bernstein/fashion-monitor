# 07 — Search Intelligence (phase 1)

This document specifies how Fashion Monitor tracks four things: what it searches for, how well each Monitor (a saved search — see CONTEXT.md) performs, what feedback feeds the LLM scorer, and when the Taste (the aesthetic half of a profile's config — see CONTEXT.md) or Monitor wording last changed.

## Concepts

| Concept | Meaning |
|---------|---------|
| **Monitor** | A saved search (in `search_groups`) that fans out across one or more platforms. Primary query + optional per-platform Query Overrides. Canonical term — avoid "Search Group", "Search Query", "Saved Search". |
| **scrape_query** | A per-platform execution row derived from a Monitor. One Monitor with 3 platforms produces 3 scrape_queries per run. |
| **Query run** | One scrape_query executed inside one pipeline `runs` row |
| **Config revision** | Snapshot of aesthetic + rules + Monitors when hash changes |
| **Prompt diet** | Static Taste config + last 15 positive / 15 negative `feedback` rows |

## Monitors in the database

Monitors live in the `search_groups` table (see 03-data-model.md). Each Monitor has:
- `query_text` — the primary query sent to all platforms.
- `platforms` — a JSON array of platform names.
- `query_overrides` — a JSON object holding per-platform replacement queries (Query Overrides — see CONTEXT.md).
- `status` — one of `active`, `needs_revision`, or `paused`.
- `note` — an optional note from the Curator (the Role that can edit Taste and Monitors — see CONTEXT.md).

You manage Monitors through the web UI (if you hold the Curator role) or the MCP server (Model Context Protocol — the interface an LLM client uses to call this system's tools; see 08-mcp-interactive.md). The legacy `searches` block in `config.yaml` bootstraps the initial scrape_queries, but once Monitors exist in the database, the database is authoritative. See CONTEXT.md's Default Searches entry.

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

These metrics roll up into two database views: `v_search_group_scorecard` (one row per Monitor) and `v_query_scorecard` (one row per platform within a Monitor):

- `total_runs`, `listings_found`, `listings_new`, `alerts_sent`
- `feedback_positive`, `feedback_negative` (via join on `source_query_id`)
- `alert_rate` = alerts / nullif(new, 0)
- `yes_rate` = yes / (yes + maybe + no)
- `feedback_ratio` = positive / (positive + negative)
- `last_alert_at`, `last_good_signal_at`

Phase 2, not yet built, adds an explicit "mark Monitor good/bad" action and auto-suggests `needs_revision` status.

## UI

- Both the CLI (command-line interface) report and the web dashboard show the **Monitor scorecard**, **Prompt diet**, and **Config timeline**.
- The web UI lets Curators add, edit, and pause Monitors without touching config files.
- Grafana (a dashboard tool) query panels are an optional follow-up.
