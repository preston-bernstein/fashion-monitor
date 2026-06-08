DROP VIEW IF EXISTS v_integration_uptime_7d;
CREATE VIEW v_integration_uptime_7d AS
SELECT
  profile_id,
  integration,
  COUNT(*) AS event_count,
  SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
  SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) AS degraded_count,
  SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) AS fail_count,
  ROUND(
    100.0 * SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
    1
  ) AS uptime_pct,
  MAX(CASE WHEN status = 'ok' THEN recorded_at END) AS last_ok_at,
  MAX(CASE WHEN status IN ('fail', 'degraded') THEN recorded_at END) AS last_problem_at
FROM integration_events
WHERE recorded_at >= datetime('now', '-7 days')
GROUP BY profile_id, integration;

DROP VIEW IF EXISTS v_integration_recent_failures;
CREATE VIEW v_integration_recent_failures AS
SELECT
  id,
  profile_id,
  run_id,
  integration,
  operation,
  status,
  error,
  duration_ms,
  recorded_at
FROM integration_events
WHERE status IN ('fail', 'degraded')
ORDER BY recorded_at DESC;

DROP VIEW IF EXISTS v_integration_daily;
CREATE VIEW v_integration_daily AS
SELECT
  profile_id,
  date(recorded_at) AS event_date,
  integration,
  COUNT(*) AS event_count,
  SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_count,
  SUM(CASE WHEN status IN ('fail', 'degraded') THEN 1 ELSE 0 END) AS problem_count
FROM integration_events
WHERE recorded_at >= datetime('now', '-30 days')
GROUP BY profile_id, date(recorded_at), integration
ORDER BY event_date DESC;
