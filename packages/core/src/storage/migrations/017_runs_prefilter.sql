-- Per-profile Health page funnel (self-service-onboarding.md Phase 4): expose
-- the prefiltered count that RunStats already computes in-memory
-- (orchestrator.ts) but was never persisted. runs.prefilter_rejected is added
-- via db.ts COLUMN_PATCHES (ALTER TABLE ADD COLUMN is not idempotent in
-- SQLite); this migration only redefines the view that reads from runs.

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
  prefilter_rejected,
  scored_yes,
  scored_maybe,
  scored_no,
  alerts_sent,
  error,
  CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END AS had_error
FROM runs;
