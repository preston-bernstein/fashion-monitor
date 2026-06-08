-- Listing image URLs (reference only) and curated per-monitor galleries.

CREATE TABLE IF NOT EXISTS listing_images (
    profile_id   TEXT NOT NULL DEFAULT 'default',
    platform     TEXT NOT NULL,
    listing_id   TEXT NOT NULL,
    url_hash     TEXT NOT NULL,
    url          TEXT NOT NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    width        INTEGER,
    height       INTEGER,
    first_seen   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (profile_id, platform, listing_id, url_hash)
);

CREATE INDEX IF NOT EXISTS idx_listing_images_listing
    ON listing_images(profile_id, platform, listing_id, position);

CREATE INDEX IF NOT EXISTS idx_listing_images_url_hash
    ON listing_images(profile_id, url_hash);

CREATE TABLE IF NOT EXISTS search_group_images (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id       TEXT NOT NULL DEFAULT 'default',
    group_id         TEXT NOT NULL,
    source           TEXT NOT NULL CHECK (source IN ('listing', 'url')),
    listing_platform TEXT,
    listing_id       TEXT,
    url              TEXT NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    caption          TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    FOREIGN KEY (group_id, profile_id) REFERENCES search_groups(id, profile_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_group_images_group
    ON search_group_images(profile_id, group_id, sort_order);
