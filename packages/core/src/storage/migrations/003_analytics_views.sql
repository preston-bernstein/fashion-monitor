-- Analytics views for DB Browser, CLI report, web dashboard, and Grafana.
-- Safe to re-run: drops before create.

DROP VIEW IF EXISTS v_run_summary;
CREATE VIEW v_run_summary AS
SELECT
  id,
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

DROP VIEW IF EXISTS v_recent_alerts;
CREATE VIEW v_recent_alerts AS
SELECT
  id,
  profile_id,
  platform,
  listing_id,
  title,
  brand,
  price,
  currency,
  url,
  score,
  llm_reason,
  alerted_at
FROM alert_log
ORDER BY alerted_at DESC;

DROP VIEW IF EXISTS v_score_by_platform;
CREATE VIEW v_score_by_platform AS
SELECT
  profile_id,
  platform,
  score,
  COUNT(*) AS listing_count
FROM seen_listings
WHERE score IS NOT NULL
GROUP BY profile_id, platform, score;

DROP VIEW IF EXISTS v_feedback_summary;
CREATE VIEW v_feedback_summary AS
SELECT
  profile_id,
  signal,
  COUNT(*) AS feedback_count
FROM feedback
GROUP BY profile_id, signal;

DROP VIEW IF EXISTS v_daily_runs;
CREATE VIEW v_daily_runs AS
SELECT
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
GROUP BY date(started_at);

DROP VIEW IF EXISTS v_seen_listings_enriched;
CREATE VIEW v_seen_listings_enriched AS
SELECT
  id,
  platform,
  profile_id,
  first_seen,
  score,
  alerted_at,
  last_price,
  CASE WHEN alerted_at IS NOT NULL THEN 1 ELSE 0 END AS was_alerted
FROM seen_listings;

DROP VIEW IF EXISTS v_platform_alert_totals;
CREATE VIEW v_platform_alert_totals AS
SELECT
  profile_id,
  platform,
  COUNT(*) AS alerts_sent,
  ROUND(AVG(price), 2) AS avg_alert_price,
  MIN(price) AS min_alert_price,
  MAX(price) AS max_alert_price
FROM alert_log
GROUP BY profile_id, platform;
