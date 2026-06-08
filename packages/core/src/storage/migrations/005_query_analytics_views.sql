-- Lineage columns (idempotent via migrate runner).
-- Views for query scorecard.

DROP VIEW IF EXISTS v_query_scorecard;
CREATE VIEW v_query_scorecard AS
SELECT
  sq.profile_id,
  sq.id AS query_id,
  sq.platform,
  sq.query_text,
  sq.status,
  sq.note,
  sq.updated_at AS query_updated_at,
  COUNT(sqr.id) AS total_runs,
  COALESCE(SUM(sqr.listings_found), 0) AS listings_found,
  COALESCE(SUM(sqr.listings_new), 0) AS listings_new,
  COALESCE(SUM(sqr.scored_yes), 0) AS scored_yes,
  COALESCE(SUM(sqr.alerts_sent), 0) AS alerts_sent,
  COALESCE(SUM(sqr.prefilter_rejected), 0) AS prefilter_rejected,
  ROUND(
    CAST(COALESCE(SUM(sqr.alerts_sent), 0) AS REAL)
    / NULLIF(COALESCE(SUM(sqr.listings_new), 0), 0),
    3
  ) AS alert_rate,
  (
    SELECT COUNT(*) FROM feedback f
    WHERE f.profile_id = sq.profile_id
      AND f.source_query_id = sq.id
      AND f.signal = 'positive'
  ) AS feedback_positive,
  (
    SELECT COUNT(*) FROM feedback f
    WHERE f.profile_id = sq.profile_id
      AND f.source_query_id = sq.id
      AND f.signal = 'negative'
  ) AS feedback_negative
FROM scrape_queries sq
LEFT JOIN scrape_query_runs sqr
  ON sqr.profile_id = sq.profile_id AND sqr.query_id = sq.id
GROUP BY sq.profile_id, sq.id, sq.platform, sq.query_text, sq.status, sq.note, sq.updated_at;

DROP VIEW IF EXISTS v_query_run_history;
CREATE VIEW v_query_run_history AS
SELECT
  sqr.id,
  sqr.run_id,
  sqr.profile_id,
  sqr.query_id,
  sqr.platform,
  sqr.query_text,
  r.started_at AS run_started_at,
  sqr.listings_found,
  sqr.listings_new,
  sqr.scored_yes,
  sqr.alerts_sent,
  sqr.prefilter_rejected,
  sqr.error
FROM scrape_query_runs sqr
JOIN runs r ON r.id = sqr.run_id
ORDER BY r.started_at DESC;

DROP VIEW IF EXISTS v_config_revision_timeline;
CREATE VIEW v_config_revision_timeline AS
SELECT
  id,
  profile_id,
  recorded_at,
  content_hash,
  run_id,
  json_extract(snapshot_json, '$.aesthetic_prompt') AS aesthetic_prompt_preview
FROM config_revisions
ORDER BY recorded_at DESC;

DROP VIEW IF EXISTS v_prompt_diet_feedback;
CREATE VIEW v_prompt_diet_feedback AS
SELECT
  f.id,
  f.profile_id,
  f.signal,
  f.platform,
  f.listing_id,
  f.source_query_id,
  sq.query_text,
  f.title,
  f.brand,
  f.price,
  f.description,
  f.recorded_at
FROM feedback f
LEFT JOIN scrape_queries sq
  ON sq.profile_id = f.profile_id AND sq.id = f.source_query_id
ORDER BY f.recorded_at DESC;
