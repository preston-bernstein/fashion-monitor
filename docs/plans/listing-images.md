# Listing images architecture

This document describes how fashion-monitor stores and serves the images that come with each scraped marketplace listing.

**Status:** The MVP is implemented, in migration 014. The auto-pick gallery, the monitor gallery-management UI, and image loading/error states were implemented on 2026-07-03. A thumbnail cache, and the `srcset` support that depends on it (the HTML attribute that lets a browser pick the right image resolution for its screen), are deferred.

---

## Audit: what scrape data has today

### In-memory `Listing` type

Every implemented platform normalizer (the code that converts a marketplace's raw API response into fashion-monitor's internal `Listing` shape) sets one primary `imageUrl`:

| Platform | Source field | Normalizer |
| --- | --- | --- |
| eBay | `item.image.imageUrl` | `packages/core/src/platforms/ebay/normalize.ts` |
| Grailed | `hit.cover_photo.url` | `packages/core/src/platforms/grailed/normalize.ts` |
| Depop | `preview[0].url` or RSC `preview` / `pictures[0].formats.P0.url` | `packages/core/src/platforms/depop/normalize.ts` |
| Poshmark | tile `img.src` | `packages/core/src/platforms/poshmark/extract.ts` → `normalize.ts` |
| Vestiaire | `pictures[0].url` | `packages/core/src/platforms/vestiaire/normalize.ts` |

Gallery URLs (the rest of a listing's photos, beyond the one cover image) exist in the raw API payloads, but were not persisted before this work:

| Platform | Raw gallery fields |
| --- | --- |
| eBay | `additionalImages[].imageUrl` |
| Grailed | `photos[].url` (the cover photo is also available at `cover_photo`) |
| Depop | `preview[]`, the RSC (React Server Component) size map, `pictures[].formats.P0` |
| Vestiaire | `pictures[].url` |
| Poshmark | single tile image only — no gallery data available |

### Existing persistence

- `seen_listings.listing_snapshot` — the full listing JSON, including `imageUrl`, while the score is `PENDING`. Cleared once scoring finishes.
- `feedback.image_url` — the primary image URL, copied at the time feedback is given.
- ntfy alerts — `sendAlert` attaches `listing.imageUrl` using ntfy's JSON publish `attach` field. This closes a gap that existed under the old Telegram alerter, whose `sendPhoto` call did the same thing. `sendDigest` still does not attach an image, because ntfy only supports one attachment per message, and a digest covers multiple listings.
- LLM vision — `prepareForLLM()` passes only the primary image's `image_url` to the model.

No dedicated image table existed before migration 014.

---

## Data model

### `listing_images` (per listing, reference URLs)

Stores the source URLs scraped from marketplaces. No image files (blobs) are stored in SQLite.

```sql
listing_images (
  profile_id, platform, listing_id, url_hash,  -- composite PK
  url, position, width, height,
  first_seen, updated_at
)
```

- **Dedup:** `url_hash` is `SHA-256(normalized URL)`, deduplicated per `(profile_id, platform, listing_id, url_hash)`.
- **Cross-listing dedup:** an index on `(profile_id, url_hash)` supports future cache or proxy reuse.
- **Population:** `ListingImagesRepo.upsertFromListing()` runs from `SeenListingsRepo` on every seen, pending, or scored insert or update.
- **Extraction:** `extractListingImages()` reads `imageUrl` plus each platform's own gallery fields from the raw payload, and filters the results through a host allowlist (see Security, below).

### `search_group_images` (curated per-monitor gallery)

Images a user picks to represent a search group — what the UI calls a Monitor.

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

- Has a foreign key (FK) to `search_groups`, with `ON DELETE CASCADE` so its rows are removed automatically when the parent monitor is deleted.
- **Curated** rows are explicit picks made by a user or through the API.
- **Auto-pick** from recent high-score listings was implemented on 2026-07-03. `ListingImagesRepo.findAutoPickForGroup()` returns the `fallback` array: only YES- and MAYBE-scored listings (NO, PENDING, and unscored listings are excluded), with YES ranked ahead of MAYBE, then by recency. This is used only when a Monitor has zero curated (`search_group_images`) rows.

---

## Storage strategy (space-conscious)

| Tier | Behavior | Status |
| --- | --- | --- |
| Default | Reference URLs only, in SQLite | **Implemented** |
| Thumbnail cache | `data/image-cache/`, keyed by URL hash, with an LRU eviction policy and a max-bytes cap | **Deferred** |
| Full-res local | Never stored in SQLite | Policy |

Principles:

- The scrape pipeline never blocks on an image download.
- The curated gallery stores URLs only; the browser loads images directly from the marketplace's CDN.
- An optional disk cache would be a separate module. It is not wired into the MVP.

---

## Performance

### UI

- `<img>` tags use `loading="lazy"` and `decoding="async"` (the `LazyImage` component), so images load only as they scroll into view.
- A monitor's gallery is fetched when its row is expanded (`GET /api/monitors/:id/images`), not when the full monitor list loads.
- The thumbnail strip is capped at 6 images per expanded row.

### API

- Paginated image lists are not required at the app's current scale; the listing endpoint returns a single ordered array.
- Cache headers: `private, max-age=60` for the monitor gallery, `max-age=300` for listing images.
- Dashboard alerts join the primary `listing_images` row through a subquery, avoiding an N+1 query pattern in the application code.

### Scrape

- Image URL extraction reads the in-memory `raw` payload synchronously. It makes no HTTP fetch during the pipeline run.

---

## Security

### Host allowlist (`packages/core/src/images/allowlist.ts`)

Each platform has its own regex pattern restricting which image hosts are accepted, for example:

- eBay: `*.ebayimg.com`
- Grailed: `*.grailed.com`, `media-assets.grailed.com`
- Depop: `*.depop.com`
- Poshmark: `*.poshmark.com`, plus its CloudFront tile CDN
- Vestiaire: `*.vestiairecollective.com`

A curated URL add accepts any known marketplace image host.

### SSRF

- The MVP has no server-side image proxy; browsers load CDN URLs directly, so there is no server-side fetch to abuse yet.
- Any future download or proxy feature must validate the URL's hostname against the listing's platform allowlist before fetching it.

### CSP

- The web app's Content Security Policy already allows `img-src https:` (`packages/api/src/web/app.ts`).

---

## API (MVP)

| Method | Path | Capability |
| --- | --- | --- |
| GET | `/api/monitors/:id/images` | `monitors:read` |
| POST | `/api/monitors/:id/images` | `monitors:write` |
| DELETE | `/api/monitors/:id/images/:imageId` | `monitors:write` |
| GET | `/api/listings/:platform/:listingId/images` | `monitors:read` |

The POST body is a discriminated union:

```json
{ "source": "listing", "platform": "ebay", "listing_id": "123" }
{ "source": "url", "url": "https://i.ebayimg.com/...", "caption": "optional" }
```

Audit actions logged: `search_group.image.add`, `search_group.image.remove`.

---

## Deferred

- The thumbnail cache module (`data/image-cache/`, with an LRU cap). This also blocks `srcset` support, since no multi-resolution image variants exist without it.
- An `upload` source for user-provided image files.
- A backfill migration that would recover older images from historical `listing_snapshot` JSON. This is an optional one-off script, not committed to.

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
