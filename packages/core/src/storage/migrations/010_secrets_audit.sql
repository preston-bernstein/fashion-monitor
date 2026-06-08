-- Encrypted-at-rest secrets/integration credentials + lightweight security audit log.

CREATE TABLE IF NOT EXISTS profile_secrets (
    profile_id   TEXT NOT NULL DEFAULT 'default',
    key          TEXT NOT NULL,
    ciphertext   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    updated_by   INTEGER,
    PRIMARY KEY (profile_id, key)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id   TEXT NOT NULL DEFAULT 'default',
    user_id      INTEGER,
    actor_email  TEXT,
    action       TEXT NOT NULL,
    target       TEXT,
    detail       TEXT,
    recorded_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_profile ON audit_log(profile_id, recorded_at DESC);
