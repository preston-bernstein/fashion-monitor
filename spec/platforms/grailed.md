# Platform: Grailed

## Status: Ready — Algolia reverse-engineered

Grailed is a menswear resale marketplace. It has no official API, so this scraper reaches its search by calling Algolia directly.

## Access Method

Grailed's search runs on Algolia. The credentials needed to call it are embedded in Grailed's page source. No auth token is required beyond the Algolia app credentials described below.

## Finding Credentials (one-time)

To find the credentials by hand: load grailed.com in a browser, open developer tools (F12), open the Network tab, and search for "algolia". Find the XHR requests to `algolia.net` and extract:
- `x-algolia-application-id` (10-char string)
- `x-algolia-api-key` (32-char string)

Or extract them programmatically from the page HTML:
```typescript
const response = await fetch("https://www.grailed.com");
const html = await response.text();

const appIdMatch = html.match(/"applicationId"\s*:\s*"([A-Z0-9]{6,20})"/);
const apiKeyMatch = html.match(/"apiKey"\s*:\s*"([a-f0-9]{20,40})"/);
if (!appIdMatch || !apiKeyMatch) {
  throw new Error("Grailed Algolia credentials not found — site structure may have changed");
}
const [, appId] = appIdMatch;
const [, apiKey] = apiKeyMatch;
```

Store the keys in `.env`. These are public, read-only keys, so the risk is low, but keeping them out of source code is still good practice.

**Note:** Grailed can rotate these keys. If search stops working, re-extract them, and validate them on startup.

## Endpoint

```
POST https://{APP_ID}-dsn.algolia.net/1/indexes/Post_production/query
```

## Search Query

```typescript
const response = await fetch(
  `https://${GRAILED_APP_ID}-dsn.algolia.net/1/indexes/Post_production/query`,
  {
    method: "POST",
    headers: {
      "x-algolia-agent": "Algolia for JavaScript (4.13.1); Browser (lite)",
      "x-algolia-api-key": GRAILED_API_KEY,
      "x-algolia-application-id": GRAILED_APP_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: "corduroy jacket shirt",
      hitsPerPage: 40,
      page: 0,
      facetFilters: [
        ["category_path:tops", "category_path:outerwear"],
        ["size:L", "size:XL", "size:XXL", "size:2XL", "size:One Size"],
        // Include L — oversized/boxy cuts labeled L often fit
        // One Size items frequently run large
        // EU sizing assessed by LLM, not filtered here
      ],
      numericFilters: ["price_i <= 300"],
    }),
  }
);
const data = await response.json();
const hits: unknown[] = data.hits ?? [];
```

## Multiple Queries

Run 2 queries per session:
- General texture/aesthetic tops: `"corduroy waffle knit wool dark textured overshirt"`
- Known brand terms: `"john varvatos helmut lang engineered garments theory"`

Add pants-specific terms as a separate query if the request budget allows:
- `"relaxed trouser dark olive charcoal pleated"` — surfaces academic-cut trousers
- Avoid "chino", "cargo", "workwear" — wrong aesthetic; use "trouser", "fatigue", "wide leg"

## Response Normalization

```typescript
function normalizeGrailed(hit: Record<string, unknown>): Listing {
  const designer = hit.designer as { name: string } | undefined;
  const coverPhoto = hit.cover_photo as { url: string } | undefined;
  const createdAt = hit.created_at as number | undefined;

  return {
    id: String(hit.id),
    platform: "grailed",
    title: hit.title as string,
    description: (hit.description as string) ?? "",
    price: parseFloat(String(hit.price_i)),
    currency: "USD",
    size: (hit.size as string) ?? "",
    brand: designer?.name ?? null,
    url: `https://www.grailed.com/listings/${hit.id}`,
    imageUrl: coverPhoto?.url ?? null,
    listedAt: createdAt ? new Date(createdAt * 1000) : null,
    condition: (hit.condition as string) ?? null,
    raw: hit,
  };
}
```

## Rate Limits

Algolia allows generous limits for read-only search. Add a 500ms delay between queries as a courtesy. No rate-limit issues are expected at personal volume.

## Notes

- Grailed skews menswear and streetwear, with good inventory for the Cave-adjacent and BJM aesthetic.
- `Post_production` is the live-listings index. If queries return empty, check whether the index name has changed.
- Sold listings live on a separate index. This scraper doesn't need it for monitoring.
