-- Unify orphan scrape_queries (group_id IS NULL) into search_groups + execution rows.

INSERT OR IGNORE INTO search_groups (id, profile_id, query_text, platforms, query_overrides, enabled, status, note, updated_at)
SELECT
  sq.id,
  sq.profile_id,
  sq.query_text,
  json_array(sq.platform),
  NULL,
  sq.enabled,
  sq.status,
  sq.note,
  sq.updated_at
FROM scrape_queries sq
WHERE sq.group_id IS NULL;

INSERT OR IGNORE INTO scrape_queries (id, profile_id, platform, query_text, enabled, status, note, updated_at, group_id)
SELECT
  sq.id || '@' || sq.platform,
  sq.profile_id,
  sq.platform,
  sq.query_text,
  sq.enabled,
  sq.status,
  sq.note,
  sq.updated_at,
  sq.id
FROM scrape_queries sq
WHERE sq.group_id IS NULL;

UPDATE scrape_query_runs
SET
  group_id = query_id,
  query_id = query_id || '@' || platform
WHERE query_id NOT LIKE '%@%'
  AND group_id IS NULL;

DELETE FROM scrape_queries WHERE group_id IS NULL;

DROP VIEW IF EXISTS v_query_scorecard;
CREATE VIEW v_query_scorecard AS
SELECT
  sq.profile_id,
  sq.id AS query_id,
  sq.group_id,
  sq.platform,
  sq.query_text,
  sq.status,
  sq.note,
  sq.updated_at AS query_updated_at,
  COUNT(sqr.id) AS total_runs,
  COALESCE(SUM(sqr.listings_found), 0) AS listings_found,
  COALESCE(SUM(sqr.listings_new), 0) AS listings_new,
  COALESCE(SUM(sqr.scored_yes), 0) AS scored_yes,
  COALESCE(SUM(sqr.scored_maybe), 0) AS scored_maybe,
  COALESCE(SUM(sqr.scored_no), 0) AS scored_no,
  COALESCE(SUM(sqr.alerts_sent), 0) AS alerts_sent,
  COALESCE(SUM(sqr.prefilter_rejected), 0) AS prefilter_rejected,
  ROUND(
    CAST(COALESCE(SUM(sqr.alerts_sent), 0) AS REAL)
    / NULLIF(COALESCE(SUM(sqr.listings_new), 0), 0),
    3
  ) AS alert_rate,
  ROUND(
    CAST(COALESCE(SUM(sqr.scored_yes), 0) AS REAL)
    / NULLIF(
        COALESCE(SUM(sqr.scored_yes), 0)
        + COALESCE(SUM(sqr.scored_maybe), 0)
        + COALESCE(SUM(sqr.scored_no), 0),
        0
      ),
    3
  ) AS yes_rate,
  (
    SELECT COUNT(*) FROM feedback f
    WHERE f.profile_id = sq.profile_id
      AND f.source_query_id = sq.group_id
      AND f.signal = 'positive'
  ) AS feedback_positive,
  (
    SELECT COUNT(*) FROM feedback f
    WHERE f.profile_id = sq.profile_id
      AND f.source_query_id = sq.group_id
      AND f.signal = 'negative'
  ) AS feedback_negative,
  ROUND(
    CAST(
      (
        SELECT COUNT(*) FROM feedback f
        WHERE f.profile_id = sq.profile_id
          AND f.source_query_id = sq.group_id
          AND f.signal = 'positive'
      ) AS REAL
    )
    / NULLIF(
        (
          SELECT COUNT(*) FROM feedback f
          WHERE f.profile_id = sq.profile_id
            AND f.source_query_id = sq.group_id
            AND f.signal = 'positive'
        )
        + (
          SELECT COUNT(*) FROM feedback f
          WHERE f.profile_id = sq.profile_id
            AND f.source_query_id = sq.group_id
            AND f.signal = 'negative'
        ),
        0
      ),
    3
  ) AS feedback_ratio,
  (
    SELECT MAX(alerted_at) FROM alert_log al
    WHERE al.profile_id = sq.profile_id
      AND al.source_query_id = sq.group_id
  ) AS last_alert_at,
  (
    SELECT MAX(ts) FROM (
      SELECT MAX(alerted_at) AS ts FROM alert_log al
      WHERE al.profile_id = sq.profile_id AND al.source_query_id = sq.group_id
      UNION ALL
      SELECT MAX(recorded_at) AS ts FROM feedback f
      WHERE f.profile_id = sq.profile_id
        AND f.source_query_id = sq.group_id
        AND f.signal = 'positive'
    )
  ) AS last_good_signal_at
FROM scrape_queries sq
LEFT JOIN scrape_query_runs sqr
  ON sqr.profile_id = sq.profile_id AND sqr.query_id = sq.id
GROUP BY sq.profile_id, sq.id, sq.group_id, sq.platform, sq.query_text, sq.status, sq.note, sq.updated_at;
