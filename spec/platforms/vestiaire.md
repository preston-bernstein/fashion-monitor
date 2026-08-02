# Platform: Vestiaire Collective

## Status: Ready — __NEXT_DATA__ parsing

Vestiaire Collective is a luxury secondhand marketplace. It's built on Next.js, and its search-result pages embed all product data in a script tag named `__NEXT_DATA__`. This scraper reads that JSON directly instead of calling an API.

## Access Method

No API call is needed. The scraper fetches the search URL and parses the JSON out of the page.

Cloudflare protects this site. At personal, low-volume use, standard request headers are enough to get through. If Cloudflare blocks a request, the fallback is ScrapFly (a paid service that fetches pages through its own anti-bot bypass) with `asp=True`. See Cloudflare Fallback below.

## Search URL Pattern

```
https://www.vestiairecollective.com/search/?q={query}&universe=M&size=XL&size=XXL&priceMax=300&order=publishedDate
```

Parameters:
- `universe=M` — Men's
- `size=XL&size=XXL` — include XL since European/Italian brands run large and XL often fits a US 2XL body
- `order=publishedDate` — newest first
- `priceMax=300` — price ceiling
- The LLM checks size accuracy using measurements and brand sizing conventions. This platform filter alone isn't precise enough.

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

Cheerio loads the page and pulls the JSON out of the `__NEXT_DATA__` script tag:

```typescript
const $ = cheerio.load(html);
const rawJson = $("#__NEXT_DATA__").text();
if (!rawJson) throw new Error("Vestiaire __NEXT_DATA__ not found — site structure may have changed");

const data = JSON.parse(rawJson);

// Navigate to product list — path may vary, inspect actual response
const products: unknown[] = data?.props?.pageProps?.initialData?.items ?? [];
```

**Important:** The exact JSON path (`props.pageProps...`) can change when Vestiaire updates its site. Verify it on first run, and add a fallback check.

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

- Fetch 1 to 2 search pages per run.
- Add a 2- to 3-second delay between requests.
- At this volume, Cloudflare shouldn't trigger a block.
- If you see a 403 error or a captcha, switch to ScrapFly. See Cloudflare Fallback below.

## Cloudflare Fallback

If standard requests get blocked, use ScrapFly's Node.js SDK instead:

```typescript
import ScrapflyClient, { ScrapeConfig } from "scrapfly-sdk";

const client = new ScrapflyClient({ key: process.env.SCRAPFLY_API_KEY! });
const result = await client.scrape(
  new ScrapeConfig({ url: searchUrl, asp: true, render_js: false })
);
const html = result.content;
```

ScrapFly's free tier allows 1,000 requests a month, enough for personal monitoring.

## Notes

- Vestiaire skews luxury European, good for Brunello Cucinelli, Helmut Lang, and Dries Van Noten.
- US inventory exists but is smaller than EU inventory. Filtering with `countryCode=US` is optional.
- An HTTP 308 redirect means the item was sold or removed. Handle it gracefully: mark the item as seen and skip it.
