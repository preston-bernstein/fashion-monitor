# Platform: Depop

## Status: Ready — impit HTTP client (Cloudflare bypass)

## Access Method

Depop retired the old `webapi.depop.com/api/v1/search/products/` endpoint (404). Search results are embedded in the Next.js RSC flight payload on `www.depop.com/search/`. Primary path: fetch that HTML with `impit` and parse embedded JSON. Playwright fallback loads the same page and parses `page.content()` if the SSR payload is missing on first fetch.

Use `gender=male` (not `mens`) and `sort=newest` in search URLs.

**Note:** Python's `cloudscraper` has no direct npm equivalent. `got-scraping` is deprecated (2025). `impit` is the current recommended replacement.

## Dependencies

```bash
npm install impit
# Playwright already a dep for Poshmark — no additional install needed for fallback
```

## Primary: impit (HTTP-level)

```typescript
import { impit } from "impit";

const client = impit({ browser: "firefox" });

const params = new URLSearchParams({
  q: "corduroy jacket shirt dark",
  categories: "mens",
  sizes: "L,XL,XXL,2XL",  // broader net — LLM filters by fit, not label
  currency: "USD",
  country: "us",
  sort: "newlyListed",
  limit: "24",
  offset: "0",
});

const response = await client.fetch(
  `https://webapi.depop.com/api/v1/search/products/?${params}`,
  {
    headers: { Referer: "https://www.depop.com/" },
  }
);
const data = await response.json();
```

`impit` handles TLS fingerprint spoofing automatically — this is what `cloudscraper` did in Python. If Depop is still blocked at HTTP level (JS challenge, not just TLS), fall back to Playwright below.

## Fallback: Playwright (browser-level)

Depop's search page renders product data via network requests. Intercept the API call directly rather than parsing DOM:

```typescript
import { chromium } from "playwright";

async function scrapeDepopViaPlaywright(query: string): Promise<unknown[]> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext();

  const intercepted: unknown[] = [];

  await context.route("**/webapi.depop.com/api/v1/search/products/**", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    intercepted.push(...(json.products ?? []));
    await route.fulfill({ response });
  });

  const page = await context.newPage();
  const params = new URLSearchParams({ q: query, department: "mens", sizes: "L,XL,XXL" });
  await page.goto(`https://www.depop.com/search/?${params}`, { waitUntil: "networkidle" });

  await browser.close();
  return intercepted;
}
```

This intercepts the API call the browser makes — clean JSON, no DOM parsing needed.

## Response Normalization

```typescript
function normalizeDepop(item: Record<string, unknown>): Listing {
  const preview = (item.preview as Array<{ url: string }> | undefined)?.[0];
  const price = item.price as { amountUsd?: string; amount?: string } | undefined;
  const sizes = item.sizes as string[] | undefined;

  return {
    id: String(item.id),
    platform: "depop",
    title: (item.description as string) ?? "",   // Depop uses description as title
    description: (item.description as string) ?? "",
    price: parseFloat(price?.amountUsd ?? price?.amount ?? "0"),
    currency: "USD",
    size: sizes?.[0] ?? "",
    brand: (item.brandName as string) ?? null,
    url: `https://www.depop.com/products/${item.slug ?? item.id}/`,
    imageUrl: preview?.url ?? null,
    listedAt: item.lastUpdated ? new Date(item.lastUpdated as string) : null,
    condition: (item.condition as string) ?? null,
    raw: item,
  };
}
```

## Pagination

```typescript
let offset = 0;
const allItems: unknown[] = [];

while (true) {
  params.set("offset", String(offset));
  const response = await client.fetch(`https://webapi.depop.com/api/v1/search/products/?${params}`);
  const data = await response.json();
  const items: unknown[] = data.products ?? [];
  allItems.push(...items);

  if (data.meta?.end === true || items.length === 0) break;

  offset += items.length;
  if (offset >= 48) break;  // 2 pages max for monitoring
}
```

Note: `meta.end` defaults to checking for explicit `true` — if `meta` key is missing entirely, `undefined === true` is `false`, so the loop continues correctly to the length check.

## Rate Limits

- Add 1-2 second delay between requests
- Personal volume: no issues expected
- If blocked: add random jitter `Math.random() * 3000 + 2000` ms between requests

## Notes

- Depop skews younger/streetwear but has good vintage and workwear pieces
- Descriptions are used as titles — often short. LLM scoring relies more on brand and visual context
- ToS technically prohibits scraping — personal low-volume use is de facto tolerated
- Image quality is generally good (high-res phone photos)
- If `impit` stops working: try Playwright network interception fallback (above)
