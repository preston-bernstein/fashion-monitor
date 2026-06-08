# 03 — Data Model

## Storage: SQLite

Single database file: `data/fashion_monitor.db`

---

## Tables

### `seen_listings`
Deduplication table. Prevents re-alerting on same listing.

```sql
CREATE TABLE seen_listings (
    id           TEXT NOT NULL,         -- platform-specific listing ID
    platform     TEXT NOT NULL,         -- "ebay" | "grailed" | "vestiaire" | "vinted" | "depop" | "poshmark"
    profile_id   TEXT NOT NULL DEFAULT 'default',  -- v2 multi-profile support; v1 always 'default'
    first_seen   TEXT NOT NULL,         -- ISO8601 datetime
    score        TEXT,                  -- "YES" | "MAYBE" | "NO" | "PENDING" — null if not yet seen for scoring
    alerted_at   TEXT,                  -- ISO8601 datetime of successful send, null if not yet sent
    last_price   REAL,                  -- most recent seen price — enables future price-drop alerts
    listing_snapshot TEXT,              -- JSON snapshot for PENDING replay when LLM unavailable
    PRIMARY KEY (platform, id, profile_id)
);
```

Note: `profile_id` is a free column now — adding it in v2 without it would require migrating the primary key. `alerted_at` replaces a boolean `alerted` flag — timestamps are strictly more useful. `last_price` included for future price-drop alerts.

**Score values:**
- `null` — seen but not yet queued for scoring (legacy; prefer PENDING for new rows)
- `PENDING` — scraped while LLM was unreachable; score on next healthy run
- `YES` | `MAYBE` | `NO` — final verdict; never re-score (verdict caching)

### `alert_log`
Record of every alert sent. Useful for reviewing what got surfaced.

```sql
CREATE TABLE alert_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT NOT NULL DEFAULT 'default',
    platform    TEXT NOT NULL,
    listing_id  TEXT NOT NULL,
    title       TEXT,
    brand       TEXT,
    price       REAL,
    currency    TEXT,
    url         TEXT,
    score       TEXT,                   -- "YES" | "MAYBE"
    llm_reason  TEXT,                   -- one-line reason from LLM
    alerted_at  TEXT NOT NULL           -- ISO8601 datetime
);
```

### `feedback`
User preference signals collected via Telegram replies. Powers few-shot learning in LLM prompt.

```sql
CREATE TABLE feedback (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      TEXT NOT NULL DEFAULT 'default',  -- feedback is per-profile — wife's ✅ teaches her model only
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
    recorded_at     TEXT NOT NULL           -- ISO8601
);

CREATE INDEX idx_feedback_signal ON feedback(profile_id, signal, recorded_at DESC);
```

Used by the system prompt builder to inject the most recent 15 positive + 15 negative examples before each scoring run. Scoped to `profile_id` — each person's feedback teaches only their own scoring. See 04-llm-scoring.md § Few-Shot Injection.

### `runs`
Run history for debugging and monitoring health.

```sql
CREATE TABLE runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    listings_found  INTEGER DEFAULT 0,
    listings_new    INTEGER DEFAULT 0,
    scored_yes      INTEGER DEFAULT 0,
    scored_maybe    INTEGER DEFAULT 0,
    scored_no       INTEGER DEFAULT 0,
    alerts_sent     INTEGER DEFAULT 0,
    error           TEXT                -- null if clean run
);
```

---

## Normalized Listing Object (in-memory)

Not persisted as a full row — only ID + score go to SQLite. Everything else lives in memory during a run and gets serialized into the alert message.

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
  condition: string | null;       // "new" | "excellent" | "good" | "fair" etc.
  raw: Record<string, unknown>;   // original API response for debugging
}
```

---

## Pruning

- `seen_listings` rows older than 90 days can be deleted safely
- `alert_log` kept indefinitely (small table)
- `runs` kept for 30 days

Pruning runs automatically at start of each run, before scraping.

---

## Price ceiling category heuristic

Pre-filter applies per-category ceilings from `price_ceiling` in config. Category is inferred from listing title (no LLM):

```typescript
type PriceCategory = "tops" | "pants" | "outerwear" | "default";

const OUTERWEAR_KEYWORDS = ["jacket", "coat", "blazer", "parka", "overcoat", "vest", "gilet"];
const PANTS_KEYWORDS = ["pants", "trousers", "jeans", "chinos", "shorts"];

function classifyPriceCategory(title: string): PriceCategory {
  const lower = title.toLowerCase();
  if (OUTERWEAR_KEYWORDS.some((k) => lower.includes(k))) return "outerwear";
  if (PANTS_KEYWORDS.some((k) => lower.includes(k))) return "pants";
  return "tops"; // shirts, knits, etc. — falls back to default ceiling if tops unset
}
```

If `price > price_ceiling[category]` (or `default`), reject before LLM.

---

## Config (not in DB)

Stored in `config.yaml` — not in SQLite, editable without touching code.

**v1 config (single profile, flat structure):**
```yaml
# config.yaml — v1 single-profile

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
  vinted: false          # deprioritized — enable when ready
  depop: true
  poshmark: true

alert:
  telegram_bot_token: "${TELEGRAM_BOT_TOKEN}"
  telegram_chat_id: "${TELEGRAM_CHAT_ID}"
  mode: "immediate"      # "immediate" | "digest"
  notify_empty: false
```

**v2 config shape (multi-profile — for reference, not implemented in v1):**
```yaml
# config.yaml — v2 multi-profile
profiles:
  default:                          # Preston
    telegram_chat_id: "${TELEGRAM_CHAT_ID_PRESTON}"
    measurements: {chest_in: "YOUR_CHEST", waist_in: 0, typical_size: "XXL"}
    aesthetic_prompt: "dark academic, tweed, corduroy, dark linen..."
    price_ceiling: {default: 300, outerwear: 500}
    platforms: [ebay, grailed, vestiaire, depop, poshmark]

  sarah:
    telegram_chat_id: "${TELEGRAM_CHAT_ID_SARAH}"
    measurements: {typical_size: "S", ...}
    aesthetic_prompt: "..."
    price_ceiling: {default: 150}
    platforms: [depop, poshmark, vestiaire]

  friend_name:
    ...
```

The profile_id column on all tables means adding a new profile in v2 is purely additive — no migration required.

Secrets (tokens, API keys) in `.env`, referenced via env vars in config.
