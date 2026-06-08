# 07 — Search intelligence (phase 1)

Track **what** we search, **how** each query performs, **what** feeds the scorer (+/−), and **when** config wording changed.

## Concepts

| Concept | Meaning |
|---------|---------|
| **Search query** | Stable `id` + platform + query text `q` (in `config.yaml` → `searches`) |
| **Query run** | One query executed inside one pipeline `runs` row |
| **Config revision** | Snapshot of aesthetic + rules + searches when hash changes |
| **Prompt diet** | Static config + last 15 positive / 15 negative `feedback` rows |

## Config

```yaml
searches:
  depop:
    - id: depop-corduroy
      q: "corduroy jacket shirt dark"
      enabled: true
      status: active          # active | needs_revision | paused
      note: "too broad?"      # optional reminder to rewrite
  ebay:
    - id: ebay-corduroy-jacket
      q: "men jacket corduroy charcoal black XXL"
```

Omitted platforms use built-in defaults (same strings as former hardcoded scraper queries).

## Tables

- `scrape_queries` — canonical query registry synced from config each run
- `scrape_query_runs` — per-run stats: found, new, scored, alerts, errors
- `config_revisions` — JSON snapshot + hash when tuning text changes
- `source_query_id` on `seen_listings`, `alert_log`, `feedback` — lineage

## “Good query” scorecard (phase 1 metrics)

Aggregated in `v_query_scorecard`:

- `total_runs`, `listings_found`, `listings_new`, `alerts_sent`
- `feedback_positive`, `feedback_negative` (via join on `source_query_id`)
- `alert_rate` = alerts / nullif(new, 0)

Phase 2 (not yet): explicit “mark query good/bad”, auto-suggest `needs_revision`.

## UI

- CLI report + web dashboard: **Search scorecard**, **Prompt diet**, **Config timeline**
- Grafana: query panels (optional follow-up)
