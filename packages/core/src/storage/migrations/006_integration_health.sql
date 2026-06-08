-- Integration connectivity / uptime events (scrapers, LLM, Telegram, etc.)

CREATE TABLE IF NOT EXISTS integration_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id   TEXT NOT NULL DEFAULT 'default',
    run_id       INTEGER,
    integration  TEXT NOT NULL,
    operation    TEXT NOT NULL,
    status       TEXT NOT NULL,
    error        TEXT,
    duration_ms  INTEGER,
    recorded_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_integration_events_lookup
  ON integration_events(profile_id, integration, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_events_status
  ON integration_events(profile_id, status, recorded_at DESC);
