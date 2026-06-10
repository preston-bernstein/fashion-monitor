# Platform: Grailed

## Status: Ready — Algolia reverse-engineered

## Access Method

Grailed uses Algolia for search. Credentials are embedded in the page source. No official API. No auth token required beyond Algolia app credentials.

## Finding Credentials (one-time)

Load grailed.com in browser → F12 → Network tab → search for "algolia" → find XHR requests to `algolia.net` → extract:
- `x-algolia-application-id` (10-char string)
- `x-algolia-api-key` (32-char string)

Or extract programmatically from page HTML:
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

Store in `.env` — these are public read-only keys, low risk but good practice.

**Note:** Keys may rotate. If search stops working, re-extract. Validate on startup.

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

Run 2 queries:
- General texture/aesthetic tops: `"corduroy waffle knit wool dark textured overshirt"`
- Known brand terms: `"john varvatos helmut lang engineered garments theory"`

Pants-specific terms (separate query if budget allows):
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

Algolia is generous for read-only search. Add 500ms between queries as courtesy. No issues expected at personal volume.

## Notes

- Grailed skews menswear/streetwear — good inventory for Cave-adjacent and BJM aesthetic
- `Post_production` is the live listings index — verify index name hasn't changed if queries return empty
- Sold listings on a different index — not needed for monitoring
