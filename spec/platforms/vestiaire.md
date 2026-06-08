# Platform: Vestiaire Collective

## Status: Ready — __NEXT_DATA__ parsing

## Access Method

Vestiaire is a Next.js app. Search result pages embed all product data in a `<script id="__NEXT_DATA__">` JSON tag. No API needed — just fetch the search URL and parse the JSON.

Protected by Cloudflare. At personal low-volume, standard headers are sufficient. If blocked, ScrapFly SDK with `asp=True` is the fallback (paid service).

## Search URL Pattern

```
https://www.vestiairecollective.com/search/?q={query}&universe=M&size=XL&size=XXL&priceMax=300&order=publishedDate
```

Parameters:
- `universe=M` — Men's
- `size=XL&size=XXL` — include XL since European/Italian brands run large and XL often fits a US 2XL body
- `order=publishedDate` — newest first
- `priceMax=300` — price ceiling
- Size accuracy assessed by LLM from measurements and brand sizing conventions, not platform filter

## Fetching

```typescript
import * as cheerio from "cheerio";

const headers = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  DNT: "1",
};

const response = await fetch(searchUrl, { headers });
if (response.status === 308) {
  // Item sold/removed — skip
  return null;
}
const html = await response.text();
```

## Parsing __NEXT_DATA__

```typescript
const $ = cheerio.load(html);
const rawJson = $("#__NEXT_DATA__").text();
if (!rawJson) throw new Error("Vestiaire __NEXT_DATA__ not found — site structure may have changed");

const data = JSON.parse(rawJson);

// Navigate to product list — path may vary, inspect actual response
const products: unknown[] = data?.props?.pageProps?.initialData?.items ?? [];
```

**Important:** The exact JSON path (`props.pageProps...`) may change with site updates. Verify on first run and add a fallback check.

## Response Normalization

```typescript
function normalizeVestiaire(item: Record<string, unknown>): Listing {
  const price = item.price as { cents: number; currency: string } | undefined;
  const brand = item.brand as { name: string } | undefined;
  const size = item.size as { name: string } | undefined;
  const pictures = item.pictures as Array<{ url: string }> | undefined;

  return {
    id: String(item.id),
    platform: "vestiaire",
    title: (item.name as string) ?? "",
    description: (item.description as string) ?? "",
    price: price ? price.cents / 100 : 0,
    currency: price?.currency ?? "USD",
    size: size?.name ?? "",
    brand: brand?.name ?? null,
    url: `https://www.vestiairecollective.com${item.link ?? ""}`,
    imageUrl: pictures?.[0]?.url ?? null,
    listedAt: item.createdAt ? new Date(item.createdAt as string) : null,
    condition: (item.condition as { name: string } | undefined)?.name ?? null,
    raw: item,
  };
}
```

## Rate Limits

- Fetch 1-2 search pages per run
- Add 2-3 second delay between requests
- At this volume Cloudflare should not trigger
- If 403/captcha: switch to ScrapFly (see below)

## Cloudflare Fallback

If standard requests get blocked, ScrapFly has a Node.js SDK:

```typescript
import ScrapflyClient, { ScrapeConfig } from "scrapfly-sdk";

const client = new ScrapflyClient({ key: process.env.SCRAPFLY_API_KEY! });
const result = await client.scrape(
  new ScrapeConfig({ url: searchUrl, asp: true, render_js: false })
);
const html = result.content;
```

ScrapFly free tier: 1,000 requests/month — sufficient for personal monitoring.

## Notes

- Vestiaire skews luxury European — good for Brunello Cucinelli, Helmut Lang, Dries Van Noten
- US inventory exists but smaller than EU — filter `countryCode=US` optional
- HTTP 308 redirect means item sold/removed — handle gracefully, mark as seen and skip
