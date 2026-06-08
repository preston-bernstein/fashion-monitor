-- DB-backed editable config: per-profile taste/system settings as key -> JSON rows.
-- scrape_queries (migration 004) is promoted to the writable monitors store; no schema change needed there.

CREATE TABLE IF NOT EXISTS profile_settings (
    profile_id  TEXT NOT NULL DEFAULT 'default',
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (profile_id, key)
);
