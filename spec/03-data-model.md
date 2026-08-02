# 03 — Data Model

This document defines Fashion Monitor's SQLite (a lightweight, file-based SQL database) schema: every table, its columns, and how the pieces fit together.

## Storage: SQLite

Fashion Monitor stores everything in a single database file: `data/fashion_monitor.db`.

---

## Tables

### `seen_listings`
This table exists to stop Fashion Monitor from alerting twice on the same listing — it's the deduplication (dedupe, short for "de-duplicate") table.

```sql
CREATE TABLE seen_listings (
    id           TEXT NOT NULL,         -- platform-specific listing ID
    platform     TEXT NOT NULL,         -- "ebay" | "grailed" | "vestiaire" | "vinted" | "depop" | "poshmark"
    profile_id   TEXT NOT NULL DEFAULT 'default',
    first_seen   TEXT NOT NULL,         -- ISO8601 datetime
    score        TEXT,                  -- "YES" | "MAYBE" | "NO" — null if not yet scored
    alerted_at   TEXT,                  -- ISO8601 datetime of successful send, null if not yet sent
    last_price   REAL,                  -- most recent seen price — enables future price-drop alerts
    listing_snapshot TEXT,              -- JSON snapshot for PENDING replay when LLM unavailable
    PRIMARY KEY (platform, id, profile_id)
);
```

**Score values:**
- `null` — seen but not yet queued for scoring. This is a legacy state; new rows should use `PENDING` instead.
- `PENDING` — pipeline-internal only: the listing was scraped while the LLM was unreachable, and it will be scored on the next healthy run. **Never surfaced to users** — users only ever see YES, MAYBE, or NO.
- `YES` | `MAYBE` | `NO` — the final verdict. Once set, it's never re-scored (the verdict is cached).

### `alert_log`
This table records every alert Fashion Monitor has sent, so you can review what got surfaced.

```sql
CREATE TABLE alert_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      TEXT NOT NULL DEFAULT 'default',
    platform        TEXT NOT NULL,
    listing_id      TEXT NOT NULL,
    title           TEXT,
    brand           TEXT,
    price           REAL,
    currency        TEXT,
    url             TEXT,
    score           TEXT,                   -- "YES" | "MAYBE"
    llm_reason      TEXT,                   -- one-line reason from LLM
    source_query_id TEXT,                   -- which Monitor/scrape_query produced this
    alerted_at      TEXT NOT NULL           -- ISO8601 datetime
);
```

### `feedback`
This table stores the user's preference signals, collected from Telegram replies. It powers few-shot learning (giving the LLM a handful of labeled examples in its prompt, instead of retraining it) in the scoring prompt.

```sql
CREATE TABLE feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      TEXT NOT NULL DEFAULT 'default',
    platform        TEXT NOT NULL,
    listing_id      TEXT NOT NULL,
    signal          TEXT NOT NULL,          -- "positive" | "negative"
    title           TEXT,
    brand           TEXT,
    description     TEXT,                   -- truncated, same as what LLM saw
    image_url       TEXT,
    price           REAL,
    condition       TEXT,
    fabric_signals  TEXT,                   -- extracted texture/fabric keywords
    source          TEXT NOT NULL DEFAULT 'telegram',  -- 'telegram' | 'seed'
    source_query_id TEXT,                   -- which Monitor produced the alerted listing
    recorded_at     TEXT NOT NULL           -- ISO8601
);
-- Seed entries (source='seed') are permanent anchors — never rotated out
-- Telegram entries rotate to most recent 30 after saturation

CREATE INDEX idx_feedback_signal ON feedback(profile_id, signal, recorded_at DESC);
```

The system prompt builder uses this table to inject the most recent 15 positive and 15 negative examples into the prompt before each scoring run. Feedback is scoped to `profile_id`, so each person's feedback only teaches that person's own scoring. See 04-llm-scoring.md § Few-Shot Injection.

### `runs`
This table stores run history, for debugging and for monitoring pipeline health.

```sql
CREATE TABLE runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id          TEXT NOT NULL DEFAULT 'default',
    started_at          TEXT NOT NULL,
    finished_at         TEXT,
    listings_found      INTEGER DEFAULT 0,
    listings_new        INTEGER DEFAULT 0,
    scored_yes          INTEGER DEFAULT 0,
    scored_maybe        INTEGER DEFAULT 0,
    scored_no           INTEGER DEFAULT 0,
    prefilter_rejected  INTEGER DEFAULT 0,
    alerts_sent         INTEGER DEFAULT 0,
    error               TEXT                -- null if clean run
);
```

---

## Identity Tables

### `profiles`
A Profile is the owner of a Taste (the aesthetic profile — the prompt, rules, and preferences the LLM scores against), a set of Monitors (a Monitor is a saved search that watches one or more platforms), and an alert destination. Every table's rows are scoped to a profile via the `profile_id` column. A Profile can exist without a web User — for example, CLI-only use.

```sql
CREATE TABLE profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
```

### `users`
A User is an authenticated account that can log into the web app. Each User holds a Role on one or more Profiles.

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_users_email ON users(lower(email));
```

### `memberships`
The memberships table joins Users to Profiles, each with a Role. One User can hold a different Role on each Profile they belong to.

```sql
CREATE TABLE memberships (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    profile_id  TEXT NOT NULL,
    role        TEXT NOT NULL,   -- "owner" | "admin" | "curator" | "operator" | "viewer"
    created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_memberships_user_profile ON memberships(user_id, profile_id);
```

**Roles and capabilities:**

Each Role grants a different set of capabilities, enforced through RBAC (role-based access control — a permissions system where what you're allowed to do depends on your assigned role):

| Role | Capabilities |
|------|-------------|
| Owner | Full access, including ownership transfer |
| Admin | Full access except ownership transfer |
| Curator | Taste + Monitors — add/edit aesthetic prompt, hard_no, Monitors |
| Operator | System config + pipeline triggers — LLM settings, platforms, run scheduling |
| Viewer | Read-only access to alerts, analytics, scorecard |

See `packages/shared/src/rbac.ts` for the 11 granular capabilities.

### `sessions`
This table stores server-side sessions used to authenticate the web app.

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    profile_id  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);
```

---

## Configuration Tables

### `profile_settings`
This table stores per-profile Taste and system settings as key/JSON rows. The web UI (Curator or Operator role, depending on the key) and the MCP server can both write to it. Values here take priority over (supersede) the YAML config file for anything scoped to a profile.

```sql
CREATE TABLE profile_settings (
    profile_id  TEXT NOT NULL DEFAULT 'default',
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (profile_id, key)
);
```

Example keys: `aesthetic_prompt`, `hard_no`, `positive_signals`, `price_ceiling`, `measurements`, `llm`.

### `profile_secrets`
This table stores per-profile credentials — Telegram tokens, platform API keys — encrypted at rest using XChaCha20-Poly1305 (an encryption algorithm) via the `@noble/ciphers` library. Plaintext credentials are never stored; only the encryption key lives in `.env`. See `docs/adr/0002-secrets-encrypted-in-db.md`.

```sql
CREATE TABLE profile_secrets (
    profile_id   TEXT NOT NULL DEFAULT 'default',
    key          TEXT NOT NULL,
    ciphertext   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    updated_by   INTEGER,
    PRIMARY KEY (profile_id, key)
);
```

### `audit_log`
This table logs security-relevant events: secret writes, role changes, config mutations.

```sql
CREATE TABLE audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id   TEXT NOT NULL DEFAULT 'default',
    user_id      INTEGER,
    actor_email  TEXT,
    action       TEXT NOT NULL,
    target       TEXT,
    detail       TEXT,
    recorded_at  TEXT NOT NULL
);
```

### `config_revisions`
This table snapshots the full profile config — a hash plus the JSON — every time the aesthetic or rule wording changes. It enables the timeline view in analytics.

```sql
CREATE TABLE config_revisions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id    TEXT NOT NULL DEFAULT 'default',
    recorded_at   TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    run_id        INTEGER
);
```

---

## Monitor Tables

### `search_groups` (Monitors)

The canonical term is **Monitor** (see CONTEXT.md). A Monitor is a saved search that watches one or more platforms. It fans out into per-platform `scrape_queries` for execution.

```sql
CREATE TABLE search_groups (
    id              TEXT NOT NULL,
    profile_id      TEXT NOT NULL DEFAULT 'default',
    query_text      TEXT NOT NULL,       -- primary query; per-platform overrides in query_overrides JSON
    platforms       TEXT NOT NULL,       -- JSON array of platform strings
    query_overrides TEXT,                -- JSON: { "ebay": "override query", ... }
    enabled         INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'active',  -- "active" | "needs_revision" | "paused"
    note            TEXT,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (id, profile_id)
);
```

### `scrape_queries`
Each row here is a per-platform execution unit: one Monitor fans out into N `scrape_queries` rows, one per platform it covers. These are the rows that actually run against each platform's search API.

```sql
CREATE TABLE scrape_queries (
    id           TEXT NOT NULL,
    profile_id   TEXT NOT NULL DEFAULT 'default',
    group_id     TEXT,                   -- Monitor id; null for legacy non-grouped queries
    platform     TEXT NOT NULL,
    query_text   TEXT NOT NULL,          -- may differ from Monitor primary query (Query Override)
    enabled      INTEGER NOT NULL DEFAULT 1,
    status       TEXT NOT NULL DEFAULT 'active',
    note         TEXT,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (id, profile_id)
);
```

### `scrape_query_runs`
This table records per-run stats for each `scrape_query`. Join it against `runs` for the full pipeline context of a given run.

```sql
CREATE TABLE scrape_query_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              INTEGER NOT NULL,
    profile_id          TEXT NOT NULL DEFAULT 'default',
    query_id            TEXT NOT NULL,
    group_id            TEXT,            -- Monitor id for rollup
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
```

---

## Integration & Image Tables

### `integration_events`
This table logs connectivity and uptime events for the scrapers, the LLM, and Telegram. The analytics dashboard uses it.

```sql
CREATE TABLE integration_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id   TEXT NOT NULL DEFAULT 'default',
    run_id       INTEGER,
    integration  TEXT NOT NULL,      -- "ebay" | "ollama" | "telegram" | etc.
    operation    TEXT NOT NULL,
    status       TEXT NOT NULL,
    error        TEXT,
    duration_ms  INTEGER,
    recorded_at  TEXT NOT NULL
);
```

### `listing_images`
This table is a registry of image URLs for listings — it stores the URLs only, and never downloads the images. It lets Fashion Monitor deduplicate image URLs across runs.

```sql
CREATE TABLE listing_images (
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
```

### `search_group_images`
This table is a curated image gallery per Monitor: reference images attached to that Monitor's entry in the web UI, so you can browse examples of what it's looking for.

```sql
CREATE TABLE search_group_images (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id       TEXT NOT NULL DEFAULT 'default',
    group_id         TEXT NOT NULL,      -- Monitor id
    source           TEXT NOT NULL,      -- "listing" | "url"
    listing_platform TEXT,
    listing_id       TEXT,
    url              TEXT NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    caption          TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    FOREIGN KEY (group_id, profile_id) REFERENCES search_groups(id, profile_id) ON DELETE CASCADE
);
```

---

## Views

### `v_query_scorecard`
A per-`scrape_query` rollup: total runs, found/new/scored/alerted, alert_rate, feedback_positive/negative, last_alert_at.

### `v_search_group_scorecard`
A per-Monitor rollup, aggregating all of that Monitor's child `scrape_query_runs`. The Curator scorecard in the web UI uses this view.

---

## Normalized Listing Object (in-memory)

This object is never persisted as a full database row. Only its ID and score go to SQLite — everything else lives only in memory, for the duration of a run.

```typescript
interface Listing {
  id: string;
  platform: "ebay" | "grailed" | "vestiaire" | "depop" | "poshmark";
  title: string;
  description: string;
  price: number;
  currency: string;
  size: string;
  brand: string | null;
  url: string;
  imageUrl: string | null;
  listedAt: Date | null;
  condition: string | null;
  raw: Record<string, unknown>;
  sourceQueryId?: string;   // which scrape_query produced this
}
```

---

## Pruning

- `seen_listings` rows older than 90 days can be safely deleted
- `alert_log` is kept indefinitely (small table)
- `runs` is kept for 30 days

Pruning runs automatically at the start of each run, before scraping.

---

## Price ceiling category heuristic

The pre-filter applies per-category price ceilings from `price_ceiling` in config. It infers the category from the listing title alone (no LLM involved):

```typescript
type PriceCategory = "tops" | "pants" | "outerwear" | "default";

const OUTERWEAR_KEYWORDS = ["jacket", "coat", "blazer", "parka", "overcoat", "vest", "gilet"];
const PANTS_KEYWORDS = ["pants", "trousers", "jeans", "chinos", "shorts"];

function classifyPriceCategory(title: string): PriceCategory {
  const lower = title.toLowerCase();
  if (OUTERWEAR_KEYWORDS.some((k) => lower.includes(k))) return "outerwear";
  if (PANTS_KEYWORDS.some((k) => lower.includes(k))) return "pants";
  return "tops";
}
```

If `price > price_ceiling[category]` (or `default`), the pre-filter rejects the listing before it reaches the LLM.

---

## Config

System-level config (`config.yaml`) covers platforms, LLM backend selection, and scraper settings. You can edit it without changing any code.

Per-profile Taste (aesthetic_prompt, hard_no, positive_signals, price_ceiling, measurements) lives in the `profile_settings` table instead, managed through the web UI (Curator role) or the MCP server. The `config.yaml` file provides bootstrap defaults that get loaded into `profile_settings` on first run.

```yaml
# config.yaml — system-level (not per-profile Taste)

profile_id: "default"

measurements:
  height: "YOUR_HEIGHT"
  weight_lbs: 0
  chest_in: "YOUR_CHEST"
  waist_in: 0
  pants_size: "YOUR_PANTS_SIZE"
  dress_shirt_neck: 0
  dress_shirt_sleeve: "YOUR_SLEEVE"
  typical_size: "XXL"

aesthetic_prompt: |
  Dark academic / textured naturalist. Natural textures, quality fabric, intentional
  not costume-y. Tweed, twill, corduroy (wide wale preferred), slub cotton, dark linen,
  Italian fabrics, structured knits. Dark palette: black, charcoal, navy, dark brown,
  burgundy, forest green. No graphics, no embroidery gimmicks, no tropical prints,
  no slim fit. Climate: Atlanta GA — breathable natural fabrics preferred year-round;
  heavy wool/tweed OK for fall/winter. References: Nick Cave, Brian Jonestown Massacre,
  Beastie Boys late 90s.

hard_no:
  - graphic tees or graphic prints
  - embroidery as decoration
  - tropical, floral, or vacation prints
  - athletic or sportswear styling
  - loud or oversized logos
  - light colors (white, cream, pastels, light grey)
  - slim fit or tailored slim

positive_signals:
  strong:
    - corduroy, tweed, twill, waffle knit, bouclé, herringbone, slub cotton, brushed cotton, linen, suede
    - Italian cotton, Pima, Supima, merino, cashmere blend
    - black, charcoal, dark grey, navy, dark brown, burgundy, forest green, slate, deep olive
    - unstructured, relaxed fit, boxy, patch pockets
    - made in Italy, Japan, USA, Portugal
  weak:
    - Japanese or Scandinavian brand
    - deadstock or NOS
    - high original retail price

price_ceiling:
  tops: 300
  pants: 250
  outerwear: 500
  default: 300

platforms:
  ebay: true
  grailed: true
  vestiaire: true
  vinted: false
  depop: true
  poshmark: true

llm:
  provider: "hybrid"
  batch_size: 15
  ollama_host: "http://192.168.1.X:11434"
  models:
    text: "qwen2.5:7b"
    vision: "llama3.2-vision:11b"
  vision_backend: "ollama"   # "ollama" | "claude"

alert:
  mode: "immediate"
  notify_empty: false
```

Telegram credentials are stored in `profile_secrets` (encrypted in the database), not in `config.yaml` or `.env`.
