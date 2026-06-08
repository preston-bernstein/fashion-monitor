-- Search intelligence: query registry, per-query run stats, config history, listing lineage.

CREATE TABLE IF NOT EXISTS scrape_queries (
    id           TEXT NOT NULL,
    profile_id   TEXT NOT NULL DEFAULT 'default',
    platform     TEXT NOT NULL,
    query_text   TEXT NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    status       TEXT NOT NULL DEFAULT 'active',
    note         TEXT,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (id, profile_id)
);

CREATE TABLE IF NOT EXISTS scrape_query_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              INTEGER NOT NULL,
    profile_id          TEXT NOT NULL DEFAULT 'default',
    query_id            TEXT NOT NULL,
    platform            TEXT NOT NULL,
    query_text          TEXT NOT NULL,
    listings_found      INTEGER DEFAULT 0,
    listings_new        INTEGER DEFAULT 0,
    scored_yes          INTEGER DEFAULT 0,
    scored_maybe        INTEGER DEFAULT 0,
    scored_no           INTEGER DEFAULT 0,
    prefilter_rejected  INTEGER DEFAULT 0,
    alerts_sent         INTEGER DEFAULT 0,
    error               TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrape_query_runs_run ON scrape_query_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_scrape_query_runs_query ON scrape_query_runs(profile_id, query_id);

CREATE TABLE IF NOT EXISTS config_revisions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id    TEXT NOT NULL DEFAULT 'default',
    recorded_at   TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    run_id        INTEGER
);

CREATE INDEX IF NOT EXISTS idx_config_revisions_profile ON config_revisions(profile_id, recorded_at DESC);
