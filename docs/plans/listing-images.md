# Listing images architecture

**Status:** MVP implemented (migration 014). Auto-pick gallery, monitor gallery-management UI, and image loading/error states implemented 2026-07-03. Thumbnail cache (and the `srcset` support that depends on it) deferred.

---

## Audit: what scrape data has today

### In-memory `Listing` type

Every implemented platform normalizer sets a single primary `imageUrl`:

| Platform | Source field | Normalizer |
| --- | --- | --- |
| eBay | `item.image.imageUrl` | `packages/core/src/platforms/ebay/normalize.ts` |
| Grailed | `hit.cover_photo.url` | `packages/core/src/platforms/grailed/normalize.ts` |
| Depop | `preview[0].url` or RSC `preview` / `pictures[0].formats.P0.url` | `packages/core/src/platforms/depop/normalize.ts` |
| Poshmark | tile `img.src` | `packages/core/src/platforms/poshmark/extract.ts` → `normalize.ts` |
| Vestiaire | `pictures[0].url` | `packages/core/src/platforms/vestiaire/normalize.ts` |

Gallery URLs exist in raw API payloads but were **not** persisted before this work:

| Platform | Raw gallery fields |
| --- | --- |
| eBay | `additionalImages[].imageUrl` |
| Grailed | `photos[].url` (cover also in `cover_photo`) |
| Depop | `preview[]`, RSC `preview` size map, `pictures[].formats.P0` |
| Vestiaire | `pictures[].url` |
| Poshmark | single tile image only |

### Existing persistence

- `seen_listings.listing_snapshot` — full listing JSON (including `imageUrl`) while score is `PENDING`; cleared after scoring.
- `feedback.image_url` — primary URL copied at feedback time.
- ntfy alerts — `sendAlert` attaches `listing.imageUrl` via ntfy's JSON publish `attach` field (closes the gap vs. the old Telegram `sendPhoto` alerter). `sendDigest` still does not attach an image — ntfy only supports one attachment per message and a digest covers multiple listings.
- LLM vision — `prepareForLLM()` passes `image_url` from primary only.

No dedicated image table existed prior to migration 014.

---

## Data model

### `listing_images` (per listing, reference URLs)

Stores source URLs scraped from marketplaces. No blobs in SQLite.

```sql
listing_images (
  profile_id, platform, listing_id, url_hash,  -- composite PK
  url, position, width, height,
  first_seen, updated_at
)
```

- **Dedup:** `url_hash = SHA-256(normalized URL)` per `(profile_id, platform, listing_id, url_hash)`.
- **Cross-listing dedup:** index on `(profile_id, url_hash)` for future cache/proxy reuse.
- **Population:** `ListingImagesRepo.upsertFromListing()` called from `SeenListingsRepo` on every seen/pending/scored insert or update.
- **Extraction:** `extractListingImages()` reads `imageUrl` + platform-specific `raw` gallery fields; filters via host allowlist.

### `search_group_images` (curated per-monitor gallery)

User-selected representative images for a search group (monitor).

```sql
search_group_images (
  id,
  profile_id, group_id,
  source,           -- 'listing' | 'url'  (upload deferred)
  listing_platform, listing_id,  -- when source = listing
  url, sort_order, caption,
  created_at, updated_at
)
```

- FK to `search_groups` with `ON DELETE CASCADE`.
- **Curated** rows are explicit user/API picks.
- **Auto-pick** from recent high-score listings: implemented 2026-07-03. `ListingImagesRepo.findAutoPickForGroup()` returns the `fallback` array — YES/MAYBE-scored listings only (NO/PENDING/unscored excluded), YES ranked ahead of MAYBE, then by recency. Used only when a Monitor has zero curated (`search_group_images`) rows.

---

## Storage strategy (space-conscious)

| Tier | Behavior | Status |
| --- | --- | --- |
| Default | Reference URLs only in SQLite | **Implemented** |
| Thumbnail cache | `data/image-cache/`, keyed by URL hash, LRU/max-bytes | **Deferred** |
| Full-res local | Never in SQLite | Policy |

Principles:

- Scrape pipeline never blocks on image download.
- Curated gallery stores URLs only; browser loads from marketplace CDN.
- Optional disk cache is a separate module (not wired in MVP).

---

## Performance

### UI

- `loading="lazy"` + `decoding="async"` on `<img>` (`LazyImage` component).
- Monitor gallery fetched on row expand (`GET /api/monitors/:id/images`), not on full list load.
- Thumbnail strip capped at 6 images per expanded row.

### API

- Paginated image lists: not required at current scale; listing endpoint returns ordered array.
- Cache headers: `private, max-age=60` (monitor gallery), `max-age=300` (listing images).
- Dashboard alerts join primary `listing_images` row (subquery, no N+1 in app code).

### Scrape

- Image URL extraction is synchronous from in-memory `raw`; no HTTP fetch during pipeline.

---

## Security

### Host allowlist (`packages/core/src/images/allowlist.ts`)

Per-platform regex patterns, e.g.:

- eBay: `*.ebayimg.com`
- Grailed: `*.grailed.com`, `media-assets.grailed.com`
- Depop: `*.depop.com`
- Poshmark: `*.poshmark.com`, CloudFront tile CDN
- Vestiaire: `*.vestiairecollective.com`

Curated URL adds accept any known marketplace image host.

### SSRF

- No server-side image proxy in MVP — browsers load CDN URLs directly.
- Future download/proxy must validate URL hostname against the listing's platform allowlist before fetch.

### CSP

- Web app `img-src` already allows `https:` (`packages/api/src/web/app.ts`).

---

## API (MVP)

| Method | Path | Capability |
| --- | --- | --- |
| GET | `/api/monitors/:id/images` | `monitors:read` |
| POST | `/api/monitors/:id/images` | `monitors:write` |
| DELETE | `/api/monitors/:id/images/:imageId` | `monitors:write` |
| GET | `/api/listings/:platform/:listingId/images` | `monitors:read` |

POST body (discriminated union):

```json
{ "source": "listing", "platform": "ebay", "listing_id": "123" }
{ "source": "url", "url": "https://i.ebayimg.com/...", "caption": "optional" }
```

Audit actions: `search_group.image.add`, `search_group.image.remove`.

---

## Deferred

- Thumbnail cache module (`data/image-cache/`, LRU cap) — also blocks `srcset` (no multi-resolution variants exist without it).
- `upload` source for user-provided files.
- Backfill migration from historical `listing_snapshot` JSON (optional one-off script).

---

## Files (MVP)

| Area | Path |
| --- | --- |
| Migration | `packages/core/src/storage/migrations/014_listing_images.sql` |
| Extract + allowlist | `packages/core/src/images/` |
| Repos | `listing-images.ts`, `search-group-images.ts` |
| Pipeline hook | `seen-listings.ts` |
| Shared schemas | `packages/shared/src/schemas/images.ts` |
| API routes | `packages/api/src/web/routes/images.ts` |
| Web | `lazy-image.tsx`, `monitor-table.tsx`, `monitor-image-manager.tsx`, `dashboard-sections.tsx` |
| Tests | `extract.test.ts`, `listing-images.test.ts`, `images.test.ts`, `monitor-image-manager.test.tsx`, `lazy-image.test.tsx` |
