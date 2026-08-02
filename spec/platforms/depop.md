# Platform: Depop

## Status: Ready — plain HTTP primary, ScrapFly-gated Cloudflare bypass, DOM-extraction fallback

Depop is a secondhand-clothing marketplace app. This file specs how the scraper pulls listings from it: which endpoint it calls, how it gets past Cloudflare (a service many sites put in front of their servers to detect and block bot traffic) when needed, and how the response maps to this project's internal `Listing` format.

## Access Method

Depop's search page (the "presentation" frontend) no longer embeds product data on the server side. Two older approaches are dead as primary paths, confirmed by live testing on 2026-07-19. One is the `webapi.depop.com/api/v1/search/products/` endpoint. The other is parsing JSON embedded via React Server Components (RSC, a Next.js feature that renders page data into the initial HTML). The current, real data source is:

```
GET https://www.depop.com/presentation/api/v1/search/products/
    ?what=<query>&limit=24&country=us&currency=USD&from=in_country_search&include_like_count=true
```

This endpoint sits behind Cloudflare. Every response, including successful ones, carries a `server: cloudflare` header and a `cf-ray` header. Even so, a plain HTTP GET through `impit` (an HTTP client library that mimics a real browser's TLS fingerprint — the pattern in an encryption handshake that sites use to tell bots from browsers) succeeded on the first live-tested attempt. No cookie warm-up and no custom headers were needed. The scraper does not build any cookie-harvesting or tracking-header machinery, because nothing so far shows it's needed. If a future run shows the plain call getting blocked reliably, add that complexity then, not before.

**Durability note:** the `v1` in the endpoint path is not a promise of stability. The endpoint it replaced was also versioned `v1`, and Depop retired it without notice anyway. Treat the current endpoint as the known-good method for now, not a permanent one.

## Dependencies

```bash
npm install impit
# scrapfly-sdk already a dep (used by Vestiaire) — reused here, no new dependency
# Playwright already a dep for Poshmark — no additional install needed for the DOM fallback
```

## Tier 1 — Primary: impit (HTTP-level, `scraper.ts`'s `searchViaHttp`)

```typescript
import { buildDepopProductsApiUrl } from "./parse-rsc.js";
import { parseDepopProducts } from "./normalize.js";

const client = await this.getClient(); // impit({ browser: "firefox" }), cached per scraper instance
const url = buildDepopProductsApiUrl(query);

const response = await client.fetch(url, {
  headers: { Referer: "https://www.depop.com/", Accept: "application/json" },
});

if (response.ok) {
  const json = await response.json();
  return parseDepopProducts(json); // empty array is a legitimate "no results", not a failure
}
```

This tier retries up to 3 times with backoff (`1500ms + attempt * 1000ms`). The retry loop covers only this tier's own plain-HTTP attempts. It never re-runs the ScrapFly tier and never relaunches the Playwright fallback more than once.

`impit` handles TLS fingerprint spoofing on its own (the Python library `cloudscraper` does the same job in Python). In live testing, that alone was enough to get past Cloudflare. No extra header or cookie engineering was needed.

## Tier 2 — Cloudflare bypass: ScrapFly (`fetch-scrapfly.ts`)

ScrapFly is a paid API that fetches a page through its own anti-bot infrastructure, so the scraper's own requests avoid getting blocked. The scraper only escalates to ScrapFly when it's confident the block is really Cloudflare, not some other error. A bare text match, say the word "Forbidden" in the response body, is never enough on its own. An ordinary non-Cloudflare 403 error could contain similar text, and misrouting that traffic would burn through the shared, budget-limited ScrapFly quota (about 1,000 requests a month, shared with Vestiaire). The scraper requires both the status code and both headers below before it treats a response as a Cloudflare challenge:

```typescript
const isCloudflareChallenge =
  (response.status === 403 || response.status === 429) &&
  response.headers.get("server") === "cloudflare" &&
  Boolean(response.headers.get("cf-ray"));
```

Only when all three conditions hold does the scraper escalate. It makes one call to `fetchDepopViaScrapfly(url, scrapflyKey)`, and only if `config.platform_credentials.scrapfly_api_key` is set (the same config key Vestiaire already uses, so no new credential was added). If no key is configured, the call throws `"ScrapFly key required for Cloudflare bypass"`. `searchQuery` catches that error and falls through to the Playwright DOM fallback (tier 3) instead of failing the whole query.

ScrapFly error responses and any Cloudflare cookies it harvests (`__cf_bm`/`_cfuvid`) are never logged verbatim. Logging them could leak the API key or a replayable session cookie into log storage.

## Tier 3 — Fallback: Playwright DOM extraction (`playwright-fallback.ts`, `extract.ts`)

If both the plain-HTTP tier and the ScrapFly tier fail, `scrapeDepopViaPlaywright` loads the search page in a real, stealth-configured browser. It uses Playwright, a library that drives a browser like Chromium or Firefox programmatically, and reads listings straight out of the rendered DOM (Document Object Model — the browser's in-memory tree of the page's HTML elements). It does not re-parse the dead RSC marker, and it does not intercept the backend API call. An earlier version of this doc described a network-interception approach. That approach was never actually built, so it's removed here to match what the code does:

```typescript
import { launchStealthEphemeralBrowser } from "../playwright/browser.js";
import { depopTileExtractScript } from "./extract.js";

const browser = await launchStealthEphemeralBrowser(); // driver governed by
                                                          // PLAYWRIGHT_STEALTH_DRIVER env flag —
                                                          // see docs/playwright-stealth-pilot.md
const page = await browser.newPage();
await page.goto(buildDepopSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 60_000 });
// dismiss OneTrust consent if present
const tiles = await page.evaluate(depopTileExtractScript); // selector: a[href*='/products/']
```

Live testing on 2026-07-19 confirmed the default/legacy stealth driver (not Patchright, a patched build of Playwright designed to look less like automation to anti-bot detection) already renders the search page into real product tiles, with no observed Cloudflare block. The stable CSS selector is `a[href*='/products/']`. Any future driver change should go through the existing `PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` flag and its hard-fence gate in `docs/playwright-stealth-pilot.md`. Patchright must pass a live smoke test on both Depop and Poshmark before the legacy stealth plugin can be removed. This file doesn't hardcode a driver.

Per-tile brand and size extraction is intentionally best-effort. Depop's DOM text layout wasn't fully mapped during live testing, so `extract.ts` returns an honest `title`/`price`/`url`/`image` and leaves `brand: null`/`size: ""` rather than guessing with a brittle text-splitting pattern. If a tile's price can't be parsed, the scraper drops that tile from the batch instead of failing the whole extraction.

## Response Normalization

The real endpoint's response shape (`normalize.ts`'s `normalizeDepopApiProduct`):

```json
{
  "meta": { "total_count": 28280 },
  "page_info": { "has_more": true, "last": "..." },
  "objects": [
    {
      "id": 823805820,
      "brand_name": "Fashion Nova",
      "description": "...",
      "slug": "buono-fashion-nova-can-it-be-a567",
      "sizes": [{ "name": "M" }],
      "pictures": [{ "formats": { "P0": { "url": "https://media-photos.depop.com/..." } } }],
      "preview": { "formats": { "P0": { "url": "https://media-photos.depop.com/..." } } },
      "attributes": { "condition": "used_excellent" },
      "pricing": {
        "currency": "USD",
        "current_price": { "price_breakdown": { "price": { "amount": "13.00" } } },
        "original_price": { "price_breakdown": { "price": { "amount": "13.00" } } },
        "is_reduced": false,
        "final_price_key": "original_price"
      }
    }
  ]
}
```

Key notes:
- The top-level array key is **`objects`**, not `products`.
- Price: read `pricing[pricing.final_price_key].price_breakdown.price.amount` — a decimal string
  (e.g. `"13.00"`), not integer cents. `final_price_key` tells you which of `current_price` /
  `original_price` is the one to actually charge; a discounted listing has
  `final_price_key: "current_price"`.
- `preview` is a **single object** (`preview.formats.P0.url`), not an array or a
  pixel-size-keyed map.
- `sizes` is an array of **objects** (`{ name, id, quantity, status, variant }`), not bare strings.
- `condition` lives under `attributes.condition`, not top-level.
- **No timestamp field of any kind exists on the product object.** `Listing.listedAt` is always
  `null` for this data source — `boosted_at` exists on some listings but means something
  different (when a paid promotion started), and is not a listing date.
- Missing `id` or an unparseable price throws (`"Depop product missing id"` /
  `"Depop product missing parseable price"`) rather than silently defaulting to `"undefined"`/`0`.

```typescript
function normalizeDepop(item) {
  return {
    id: String(item.id),
    platform: "depop",
    title: item.description || slugToTitle(item.slug),
    description: item.description || slugToTitle(item.slug),
    price: parseFloat(finalPriceEntry.price_breakdown.price.amount),
    currency: item.pricing.currency ?? "USD",
    size: item.sizes?.[0]?.name ?? "",
    brand: item.brand_name ?? null,
    url: `https://www.depop.com/products/${item.slug}/`,
    imageUrl: item.preview?.formats?.P0?.url ?? item.pictures?.[0]?.formats?.P0?.url ?? null,
    listedAt: null,
    condition: item.attributes?.condition ?? null,
    raw: { ...item, _normalizerSource: "api" },
  };
}
```

### Legacy RSC-shaped branch (retained, not dead)

This repo keeps the pre-2026-07-19 RSC-embedded-JSON parser (`parse-rsc.ts`'s `extractDepopSearchFromHtml` / `extractDepopListingsFromHtml` / `SEARCH_MARKER`) and its matching normalizer (`normalizeDepopRscProduct`, which runs when `item.pricing` is present but has no `final_price_key`). It's documented legacy, not deleted code. Live testing found this old shape maps to a closely related version of the same backend schema: the same `pricing.<key>.price_breakdown.price.amount` and `pictures[].formats.P0.url` field paths. That's close enough that deleting the parser now, before seeing a real response take this exact shape again, would be premature. No code path in this scraper currently reaches it. It stays in the repo in case a similar shape shows up again.

## Pagination

The scraper requests `limit=24` and fetches a single page. It does not implement cursor pagination (`page_info.after`/`last`). An earlier plan called for 2 pages and 48 items, but that plan was never built. Fetching only one page is a known, accepted limit, not an oversight.

## Rate Limits

- The primary HTTP tier retries up to 3 times with backoff (`1500ms + attempt*1000ms`). ScrapFly and the Playwright fallback each get one attempt per query; neither retries in a loop.
- At personal, low-volume use, the primary tier should hit no rate-limit issues.
- ScrapFly usage should stay rare, since the Cloudflare-detection rule requires both headers before escalating. It shares its request budget with Vestiaire's ScrapFly usage.

## Notes

- Depop skews younger and streetwear, but also has good vintage and workwear pieces.
- Listing descriptions double as titles and are often short. The LLM (the scoring model that rates each listing) leans more on brand name and image content than on description text.
- Depop's Terms of Service (ToS, the site's usage rules) technically prohibit scraping. In practice, personal low-volume use is tolerated.
- Image quality is generally good, since most photos are high-res phone shots.
- If the primary HTTP tier stops working, whether Depop changes the endpoint again or starts genuinely blocking `impit`'s TLS fingerprint, re-run a live investigation (a real browser network trace) before touching any code. Don't guess at a new endpoint or re-enable speculative cookie/header engineering without evidence that it's needed.
