# Task 1 Live-Verification Findings (2026-07-19)

Real, reproducible checks run from this machine (Mac clone, not the NAS deploy network — see
caveat at bottom). One plain HTTP call via `impit`, one real browser page-load via the existing
`launchStealthEphemeralBrowser()` (legacy driver). No loops, no retries, single query
"corduroy jacket" throughout. Scripts were throwaway (`scripts/tmp-depop-verify-*.mjs`) and have
been deleted after use, per this repo's own scraping discipline.

## (a) Confirmed endpoint

`GET https://www.depop.com/presentation/api/v1/search/products/?what=<query>&limit=24&country=us&currency=USD&from=in_country_search&include_like_count=true`
is live and correct as drafted in plan.md.

Separately, the real browser's own client-side hydration calls the **`webapi.depop.com`** host
for equivalent endpoints (e.g. `webapi.depop.com/presentation/api/v2/products/aggregates/...`),
not `www.depop.com`. Both hosts appear to serve live data; the plain-HTTP tier should keep using
`www.depop.com` (confirmed working directly), but this is worth a one-line comment in the code
in case `www.depop.com` gets deprecated in favor of `webapi.depop.com` later.

## (b) Plain HTTP result: SUCCEEDS, no cookie warm-up or custom headers needed

A single `impit` (`browser: "firefox"`) GET, no cookie harvesting, no `Referer` beyond the
existing header, no `depop-device-id`/`depop-search-id`/`depop-session-id` headers, returned
**HTTP 200** on the first and only attempt — despite the response carrying `server: cloudflare`
and a `cf-ray` header (Cloudflare is fronting the endpoint, but did not block this request).

This directly contradicts the deleted trace's earlier finding of a 403 on the same endpoint.
The most likely explanation: that earlier 403 came from **patchright's raw fetch**, which leaked
`sec-ch-ua: "HeadlessChrome"` — a bot-fingerprint tell that `impit`'s Firefox TLS/header
impersonation does not have. **Decision: do not build Task 8b's cookie-harvest/UUID-header
engineering.** Plain HTTP already works unassisted; the added complexity has no evidence behind
it and per plan.md's own conditional, should not be built. ScrapFly (Task 5) should still be
implemented as a real, working code path (Cloudflare-detection is a legitimate defensive
measure and this endpoint is genuinely Cloudflare-fronted), but is not expected to be exercised
on a healthy run.

## (c) Real success-response JSON shape

Top level: `{ "meta": { "total_count": number }, "page_info": { "has_more": boolean, "last": string }, "objects": [ ...products ] }`

**The top-level array key is `objects`, not `products`.** This must be reflected in the fetch
layer and normalizer.

Per-product shape (fields relevant to normalization):
```json
{
  "id": 823805820,
  "brand_name": "Fashion Nova",
  "description": "Fashion Nova 'Can It Be Corduroy Jacket' with white sherpa lining #sherpa #outerwear",
  "slug": "buono-fashion-nova-can-it-be-a567",
  "sizes": [{ "name": "M", "id": 17, "quantity": 1, "status": "STATUS_ONSALE", "variant": "M" }],
  "pictures": [{ "id": 4199061637, "formats": { "P0": { "url": "https://media-photos.depop.com/..." } } }],
  "preview": { "id": 4199061637, "formats": { "P0": { "url": "https://media-photos.depop.com/..." } } },
  "attributes": { "condition": "used_excellent", "brand": "fashion-nova", "gender": "female" },
  "pricing": {
    "currency": "USD",
    "current_price": { "total_price": "13.00", "price_breakdown": { "price": { "amount": "13.00" }, "shipping": { "amount": "3.99" } } },
    "original_price": { "total_price": "13.00", "price_breakdown": { "price": { "amount": "13.00" } } },
    "is_reduced": false,
    "final_price_key": "original_price"
  }
}
```

**This is nearly identical to the existing `normalizeDepopRscProduct` branch's expected shape**
(`pricing.<key>.price_breakdown.price.amount`, `pictures[].formats.P0.url`) — the same
underlying Depop backend schema, just reached via a different top-level wrapper (`objects`
instead of whatever RSC's nesting produced). Concretely:

- **Price**: use `pricing[pricing.final_price_key].price_breakdown.price.amount` (decimal
  string, e.g. `"13.00"`) — `final_price_key` tells you which of `current_price`/`original_price`
  is the one to display; don't hardcode `original_price` as the old code did, since a
  discounted listing would have `final_price_key: "current_price"` instead. `parseFloat()` is
  the correct parse (decimal string confirmed, not integer cents).
- **Preview image**: `preview.formats.P0.url` — a single object, NOT an array or a
  pixel-size-keyed map like the old RSC branch assumed (`preview["640"]`). This one field
  actually differs from the old shape and needs a small adjustation, not a wholesale rewrite.
- **Pictures fallback**: `pictures[0].formats.P0.url` matches the old RSC branch's assumption
  exactly, usable as a fallback if `preview` is ever absent.
- **id**: `String(item.id)` is fine — always a real number, never missing in the 24 samples
  observed.
- **slug**: present on every sampled item; use for the URL (`depop.com/products/<slug>/`).
- **sizes**: array of objects now (`{name, id, quantity, status, variant}`), not bare strings —
  use `sizes[0]?.name`, not `sizes[0]` directly (this is a real shape change from the legacy
  webapi branch, which had bare-string sizes).
- **condition**: `attributes.condition` (e.g. `"used_excellent"`), not a top-level `condition`
  field.
- **brand**: `brand_name` at the top level (matches old webapi shape's `brandName` closely
  enough — just renamed with an underscore).
- **No timestamp field of any kind exists on the product object.** There is no `listedAt`
  equivalent — `boosted_at` exists but only on boosted listings and means something different
  (when a paid promotion started, not when the item was listed). **`Listing.listedAt` must be
  `null` for this data source** — do not invent a timestamp from an unrelated field, and do not
  guess at an ISO-vs-epoch shape since there is nothing to parse here at all.

**Decision on the RSC-branch retention question (per the running decision point in requirements
FR14, plan.md Data model, and steps.md Tasks 3/4/7/10): KEEP `normalizeDepopRscProduct` and
`parse-rsc.ts`'s extraction functions as documented legacy.** The pricing/pictures shape is
close enough to the new endpoint's real shape that treating it as dead code would be wrong —
but it is not a byte-for-byte match either (top-level wrapper differs, `preview` differs,
`sizes` differs), so it should NOT be reused unmodified as the new endpoint's normalizer. Add a
**new** normalizer function for the new endpoint's confirmed shape (per the above), and leave
`normalizeDepopRscProduct` in place with a comment noting it mapped the same backend reached via
the now-dead RSC-embedded path, retained in case that path or a similar shape resurfaces.

## (d) Playwright/browser fallback: DOES reach real hydrated product tiles

Using the **existing legacy stealth driver** (`launchStealthEphemeralBrowser()` with no driver
override — i.e. `playwright-extra` + `puppeteer-extra-plugin-stealth`, NOT patchright), loading
`https://www.depop.com/search/?q=corduroy+jacket` and waiting ~4s after `domcontentloaded`:

- The page hydrates to real content — page text shows real brand names, sizes, and prices
  ("Gap / S / $12.00 / $10.00", "Fashion Nova / S / $10.00", etc.) — this is NOT a Cloudflare
  challenge page.
- Confirmed real DOM selector: **`a[href*='/products/']`** matched exactly 24 elements (the
  page size) — a stable, semantic selector (product links), preferable to matching on
  `[class*='styles_productCard']` which also matched 24 but is a CSS-module-generated class
  name and more likely to change across Depop frontend deploys.
- The browser's own network activity confirmed it makes calls to `webapi.depop.com`'s
  presentation-API family for supporting data (CMS content, size filters, aggregates, session
  events) — consistent with (but not proof of an exact 1:1 call to) the same products-search
  backend the primary HTTP tier hits directly.
- **No Cloudflare block was observed in this browser session.** This means, on this network at
  this time, neither tier is currently blocked — so risk area 1 in plan.md ("the fallback may
  share tier 1's failure") could not be confirmed OR refuted from this single run; it remains a
  real possibility for a future session where Cloudflare's posture changes, but is not
  presently observed.

## Caveats (carried forward honestly, not glossed over)

- **This ran from a Mac dev clone, not the NAS deploy network** — plan.md's risk area 3 flags
  that IP reputation could differ. Today's success does not guarantee the NAS's egress IP gets
  the same treatment. The final opt-in live-verification (`pnpm run verify:scrapers` /
  `pnpm run test:live`) run against the real deploy target remains the acceptance-criteria-5
  check that actually matters for production confidence.
- **Single-request sample.** One plain-HTTP call and one browser session, both successful, is
  not proof Cloudflare will never block either tier — it is evidence that, absent further
  signal, over-building defensive complexity (cookie/header engineering) ahead of any observed
  need is not justified right now. The ScrapFly tier (Task 5) is still built as a real,
  reachable code path for when/if blocking is observed later, per FR6.
- **`final_price_key` should be trusted, not assumed to always be `original_price`.** All 24
  sampled items happened to have `is_reduced: false` and `final_price_key: "original_price"` —
  no discounted item was observed in this sample to confirm the `current_price` branch's exact
  shape, though the pricing object's structure is symmetric between the two keys so this is a
  low-risk assumption, not an unverified one.
