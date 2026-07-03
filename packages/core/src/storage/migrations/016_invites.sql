-- Self-service onboarding Phase 2 (ADR-0003): one-time invite links.
-- Shared machinery for both signup invites and owner-regenerated password
-- resets (same table, `purpose` distinguishes them) per docs/plans/self-service-onboarding.md.
-- The token itself is never stored — only its hash (see packages/api/src/web/invites.ts).

CREATE TABLE IF NOT EXISTS invites (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash       TEXT NOT NULL,
    purpose          TEXT NOT NULL DEFAULT 'signup',
    created_by       INTEGER NOT NULL,
    target_user_id   INTEGER,
    profile_id       TEXT,
    expires_at       TEXT NOT NULL,
    consumed_at      TEXT,
    created_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invites_token_hash ON invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_invites_expires ON invites(expires_at);
