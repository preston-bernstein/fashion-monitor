-- Multi-profile serial pipeline (ADR-0005): scope runs to a profile.
-- runs.profile_id is added via db.ts COLUMN_PATCHES (ALTER TABLE ADD COLUMN
-- is not idempotent in SQLite), matching existing precedent for
-- seen_listings.source_query_id / scrape_queries.group_id etc. This
-- migration only redefines the views that read from runs.

DROP VIEW IF EXISTS v_run_summary;
CREATE VIEW v_run_summary AS
SELECT
  id,
  profile_id,
  started_at,
  finished_at,
  CASE
    WHEN finished_at IS NOT NULL
    THEN CAST((julianday(finished_at) - julianday(started_at)) * 86400 AS INTEGER)
    ELSE NULL
  END AS duration_seconds,
  listings_found,
  listings_new,
  scored_yes,
  scored_maybe,
  scored_no,
  alerts_sent,
  error,
  CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END AS had_error
FROM runs;

DROP VIEW IF EXISTS v_daily_runs;
CREATE VIEW v_daily_runs AS
SELECT
  profile_id,
  date(started_at) AS run_date,
  COUNT(*) AS run_count,
  SUM(listings_found) AS total_found,
  SUM(listings_new) AS total_new,
  SUM(scored_yes) AS total_yes,
  SUM(scored_maybe) AS total_maybe,
  SUM(scored_no) AS total_no,
  SUM(alerts_sent) AS total_alerts,
  SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS error_runs
FROM runs
GROUP BY profile_id, date(started_at);
