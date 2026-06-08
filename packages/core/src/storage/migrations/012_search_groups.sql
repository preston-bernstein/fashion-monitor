-- Search groups: logical multi-platform monitors with per-platform execution rows.

CREATE TABLE IF NOT EXISTS search_groups (
    id              TEXT NOT NULL,
    profile_id      TEXT NOT NULL DEFAULT 'default',
    query_text      TEXT NOT NULL,
    platforms       TEXT NOT NULL,
    query_overrides TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'active',
    note            TEXT,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_search_groups_profile ON search_groups(profile_id);

CREATE INDEX IF NOT EXISTS idx_scrape_queries_group ON scrape_queries(profile_id, group_id);
CREATE INDEX IF NOT EXISTS idx_scrape_query_runs_group ON scrape_query_runs(profile_id, group_id);

-- Per-execution scorecard (platform drill-down); unchanged semantics, includes group_id.
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
      AND f.source_query_id = COALESCE(sq.group_id, sq.id)
      AND f.signal = 'positive'
  ) AS feedback_positive,
  (
    SELECT COUNT(*) FROM feedback f
    WHERE f.profile_id = sq.profile_id
      AND f.source_query_id = COALESCE(sq.group_id, sq.id)
      AND f.signal = 'negative'
  ) AS feedback_negative,
  ROUND(
    CAST(
      (
        SELECT COUNT(*) FROM feedback f
        WHERE f.profile_id = sq.profile_id
          AND f.source_query_id = COALESCE(sq.group_id, sq.id)
          AND f.signal = 'positive'
      ) AS REAL
    )
    / NULLIF(
        (
          SELECT COUNT(*) FROM feedback f
          WHERE f.profile_id = sq.profile_id
            AND f.source_query_id = COALESCE(sq.group_id, sq.id)
            AND f.signal = 'positive'
        )
        + (
          SELECT COUNT(*) FROM feedback f
          WHERE f.profile_id = sq.profile_id
            AND f.source_query_id = COALESCE(sq.group_id, sq.id)
            AND f.signal = 'negative'
        ),
        0
      ),
    3
  ) AS feedback_ratio,
  (
    SELECT MAX(alerted_at) FROM alert_log al
    WHERE al.profile_id = sq.profile_id
      AND al.source_query_id = COALESCE(sq.group_id, sq.id)
  ) AS last_alert_at,
  (
    SELECT MAX(ts) FROM (
      SELECT MAX(alerted_at) AS ts FROM alert_log al
      WHERE al.profile_id = sq.profile_id AND al.source_query_id = COALESCE(sq.group_id, sq.id)
      UNION ALL
      SELECT MAX(recorded_at) AS ts FROM feedback f
      WHERE f.profile_id = sq.profile_id
        AND f.source_query_id = COALESCE(sq.group_id, sq.id)
        AND f.signal = 'positive'
    )
  ) AS last_good_signal_at
FROM scrape_queries sq
LEFT JOIN scrape_query_runs sqr
  ON sqr.profile_id = sq.profile_id AND sqr.query_id = sq.id
GROUP BY sq.profile_id, sq.id, sq.group_id, sq.platform, sq.query_text, sq.status, sq.note, sq.updated_at;

-- Group-level rollup for curator scorecard (aggregates execution rows + group-tagged lineage).
DROP VIEW IF EXISTS v_search_group_scorecard;
CREATE VIEW v_search_group_scorecard AS
SELECT
  sg.profile_id,
  sg.id AS group_id,
  sg.query_text,
  sg.platforms,
  sg.status,
  sg.note,
  sg.updated_at AS group_updated_at,
  COUNT(DISTINCT sqr.id) AS total_runs,
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
    WHERE f.profile_id = sg.profile_id
      AND f.source_query_id = sg.id
      AND f.signal = 'positive'
  ) AS feedback_positive,
  (
    SELECT COUNT(*) FROM feedback f
    WHERE f.profile_id = sg.profile_id
      AND f.source_query_id = sg.id
      AND f.signal = 'negative'
  ) AS feedback_negative,
  ROUND(
    CAST(
      (
        SELECT COUNT(*) FROM feedback f
        WHERE f.profile_id = sg.profile_id
          AND f.source_query_id = sg.id
          AND f.signal = 'positive'
      ) AS REAL
    )
    / NULLIF(
        (
          SELECT COUNT(*) FROM feedback f
          WHERE f.profile_id = sg.profile_id
            AND f.source_query_id = sg.id
            AND f.signal = 'positive'
        )
        + (
          SELECT COUNT(*) FROM feedback f
          WHERE f.profile_id = sg.profile_id
            AND f.source_query_id = sg.id
            AND f.signal = 'negative'
        ),
        0
      ),
    3
  ) AS feedback_ratio,
  (
    SELECT MAX(alerted_at) FROM alert_log al
    WHERE al.profile_id = sg.profile_id
      AND al.source_query_id = sg.id
  ) AS last_alert_at,
  (
    SELECT MAX(ts) FROM (
      SELECT MAX(alerted_at) AS ts FROM alert_log al
      WHERE al.profile_id = sg.profile_id AND al.source_query_id = sg.id
      UNION ALL
      SELECT MAX(recorded_at) AS ts FROM feedback f
      WHERE f.profile_id = sg.profile_id
        AND f.source_query_id = sg.id
        AND f.signal = 'positive'
    )
  ) AS last_good_signal_at
FROM search_groups sg
LEFT JOIN scrape_query_runs sqr
  ON sqr.profile_id = sg.profile_id AND sqr.group_id = sg.id
GROUP BY sg.profile_id, sg.id, sg.query_text, sg.platforms, sg.status, sg.note, sg.updated_at;
