# Platform: Depop

## Status: Ready — plain HTTP primary, ScrapFly-gated Cloudflare bypass, DOM-extraction fallback

## Access Method

Depop's search page ("presentation" frontend) no longer embeds product data server-side —
the old `webapi.depop.com/api/v1/search/products/` endpoint and the Next.js RSC-embedded-JSON
approach are both retired/dead as primary paths (confirmed via live investigation, 2026-07-19).
The current, real data source is:

```
GET https://www.depop.com/presentation/api/v1/search/products/
    ?what=<query>&limit=24&country=us&currency=USD&from=in_country_search&include_like_count=true
```

This endpoint is genuinely Cloudflare-fronted (`server: cloudflare`, `cf-ray` header present on
every response, including successful ones) — but a **plain HTTP GET via `impit`** (no cookie
warm-up, no custom headers) succeeded on the very first live-tested attempt. No cookie-harvest
or generated tracking-header machinery is built, since there is no evidence it's needed; if a
future run shows the plain call reliably blocked, that complexity can be added then.

**Note on durability**: the endpoint's `v1` naming is not a guarantee of stability — the
endpoint it replaces was also versioned `v1` and was retired without notice anyway. Treat this
as the current known-good access method, not a permanent one.

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

Retried up to 3 attempts with backoff (`1500ms + attempt * 1000ms`) — this retry loop applies
**only** to this tier's own plain-HTTP attempts. It does not re-run the ScrapFly tier or relaunch
the Playwright fallback multiple times.

`impit` handles TLS fingerprint spoofing (the Python `cloudscraper` equivalent) — this alone was
sufficient to pass Cloudflare in live testing, with no additional header/cookie engineering.

## Tier 2 — Cloudflare bypass: ScrapFly (`fetch-scrapfly.ts`)

Cloudflare-challenge detection is intentionally **strict** — a bare body-text match (e.g. the
word "Forbidden") is never sufficient on its own, since an ordinary non-Cloudflare 403 could
contain similar text and would misroute traffic into the shared, budget-limited ScrapFly quota
(~1,000 req/month, shared with Vestiaire). The required signal:

```typescript
const isCloudflareChallenge =
  (response.status === 403 || response.status === 429) &&
  response.headers.get("server") === "cloudflare" &&
  Boolean(response.headers.get("cf-ray"));
```

Only when both the status code and both headers are present does the scraper escalate — a
**one-shot** call to `fetchDepopViaScrapfly(url, scrapflyKey)`, gated on
`config.platform_credentials.scrapfly_api_key` (the same config key Vestiaire already uses — no
new credential was added). No key configured → throws `"ScrapFly key required for Cloudflare
bypass"`, which `searchQuery` catches and falls through to the Playwright DOM fallback (tier 3)
rather than failing the whole query outright.

ScrapFly error responses and any harvested Cloudflare cookies (`__cf_bm`/`_cfuvid`) are never
logged verbatim, to avoid leaking the API key or a replayable session cookie into log storage.

## Tier 3 — Fallback: Playwright DOM extraction (`playwright-fallback.ts`, `extract.ts`)

If both the plain-HTTP tier and the ScrapFly tier fail, `scrapeDepopViaPlaywright` loads the
search page in a real (stealth) browser and extracts listings directly from the rendered DOM —
**not** by re-parsing the dead RSC marker, and **not** by intercepting the backend API call (the
network-interception approach previously documented here was never actually implemented in
code and has been removed from this doc to match reality):

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

Confirmed live (2026-07-19): the **default/legacy** stealth driver (not Patchright) already
hydrates the search page to real product tiles with no observed Cloudflare block. The confirmed,
stable CSS selector is `a[href*='/products/']`. Any future driver change should go through the
existing `PLAYWRIGHT_STEALTH_DRIVER=patchright|legacy` flag and its hard-fence gate in
`docs/playwright-stealth-pilot.md` (Patchright must pass live smoke on **both** Depop and
Poshmark before the legacy stealth plugin can be removed) — this file does not hardcode a driver.

Per-tile brand/size extraction is intentionally best-effort: Depop's DOM text layout wasn't fully
mapped live, so `extract.ts` returns an honest `title`/`price`/`url`/`image` and leaves
`brand: null`/`size: ""` rather than guessing at a brittle text-splitting pattern. A tile whose
price can't be parsed is dropped from the batch rather than failing the whole extraction.

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

The pre-2026-07-19 RSC-embedded-JSON parser (`parse-rsc.ts`'s `extractDepopSearchFromHtml` /
`extractDepopListingsFromHtml` / `SEARCH_MARKER`) and its matching normalizer
(`normalizeDepopRscProduct`, dispatched when `item.pricing` is present but has no
`final_price_key`) are **kept as documented legacy**, not deleted. The live investigation found
this shape maps a closely related version of the same backend schema (same
`pricing.<key>.price_breakdown.price.amount` and `pictures[].formats.P0.url` field paths) — close
enough that deleting it outright, before ever seeing a real response take that exact shape again,
would be premature. It is not currently reachable via any code path this scraper invokes; it is
kept in case a similar shape resurfaces.

## Pagination

`limit=24` — a single page, no cursor pagination (`page_info.after`/`last`) implemented. This is
a known, accepted regression versus the earlier (never-implemented) aspirational 2-page/48-item
approach, not an oversight.

## Rate Limits

- 3-attempt/backoff retry (`1500ms + attempt*1000ms`) on the primary HTTP tier only; ScrapFly and
  the Playwright fallback are each attempted once per query, never retried in a loop.
- Personal, low-volume use: no issues expected on the primary tier.
- ScrapFly usage should stay rare given the tightened (header-required) Cloudflare-detection rule
  — it shares a budget with Vestiaire's ScrapFly usage.

## Notes

- Depop skews younger/streetwear but has good vintage and workwear pieces.
- Descriptions double as titles — often short; LLM scoring relies more on brand and visual context.
- ToS technically prohibits scraping — personal low-volume use is de facto tolerated.
- Image quality is generally good (high-res phone photos).
- If the primary HTTP tier stops working (Depop changes the endpoint again, or genuinely starts
  blocking `impit`'s TLS fingerprint): re-run a live investigation (real browser network trace)
  before touching code — do not guess at a new endpoint or re-enable speculative
  cookie/header engineering without evidence it's needed.
