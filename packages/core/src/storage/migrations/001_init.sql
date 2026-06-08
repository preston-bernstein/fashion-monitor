CREATE TABLE IF NOT EXISTS seen_listings (
    id           TEXT NOT NULL,
    platform     TEXT NOT NULL,
    profile_id   TEXT NOT NULL DEFAULT 'default',
    first_seen   TEXT NOT NULL,
    score        TEXT,
    alerted_at   TEXT,
    last_price   REAL,
    listing_snapshot TEXT,
    PRIMARY KEY (platform, id, profile_id)
);

CREATE TABLE IF NOT EXISTS alert_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT NOT NULL DEFAULT 'default',
    platform    TEXT NOT NULL,
    listing_id  TEXT NOT NULL,
    title       TEXT,
    brand       TEXT,
    price       REAL,
    currency    TEXT,
    url         TEXT,
    score       TEXT,
    llm_reason  TEXT,
    alerted_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      TEXT NOT NULL DEFAULT 'default',
    platform        TEXT NOT NULL,
    listing_id      TEXT NOT NULL,
    signal          TEXT NOT NULL,
    title           TEXT,
    brand           TEXT,
    description     TEXT,
    image_url       TEXT,
    price           REAL,
    condition       TEXT,
    fabric_signals  TEXT,
    recorded_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_signal ON feedback(profile_id, signal, recorded_at DESC);

CREATE TABLE IF NOT EXISTS runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    listings_found  INTEGER DEFAULT 0,
    listings_new    INTEGER DEFAULT 0,
    scored_yes      INTEGER DEFAULT 0,
    scored_maybe    INTEGER DEFAULT 0,
    scored_no       INTEGER DEFAULT 0,
    alerts_sent     INTEGER DEFAULT 0,
    error           TEXT
);

CREATE TABLE IF NOT EXISTS feedback_bot_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
