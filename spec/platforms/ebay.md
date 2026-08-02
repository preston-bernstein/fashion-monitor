# Platform: eBay

## Status: Ready — Official API

eBay is a general marketplace. This scraper reaches it through eBay's own official Browse API, not a workaround, so this file is short compared to the other platform specs.

## Access Method

This platform uses eBay's Browse API, the official, documented interface eBay publishes for search. It's free for personal use.

- Docs: developer.ebay.com/api-docs/buy/browse/overview.html
- Auth: OAuth 2.0 Client Credentials flow (an app-level login exchange; no user account or password needed)
- Base URL: `https://api.ebay.com/buy/browse/v1/item_summary/search`

## Setup

1. Register at developer.ebay.com
2. Create application → get `App ID` (client ID) and `Cert ID` (client secret)
3. Generate OAuth token:
   ```
   POST https://api.ebay.com/identity/v1/oauth2/token
   grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope
   ```
4. The token is valid for 2 hours. Refresh it automatically before it expires.

## Search Query

```typescript
const params = new URLSearchParams({
  q: "men shirt jacket corduroy XXL",
  category_ids: "57988",  // Men's Clothing
  filter: "itemLocationCountry:US,conditions:{USED|NEW}",
  sort: "newlyListed",
  limit: "50",
});

const response = await fetch(
  `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
  {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  }
);
const data = await response.json();
const items: unknown[] = data.itemSummaries ?? [];
```

## Multiple Queries

Run 2 to 3 queries per session to cover different search angles:
- `"men jacket corduroy charcoal black XXL"`
- `"john varvatos helmut lang theory XXL shirt"`
- `"dale norway sweater men XXL wool"`

The scraper deduplicates results by item ID in memory before writing to the database.

## Response Normalization

```typescript
type EbayAspect = { name: string; value: string };

function extractAspect(aspects: EbayAspect[], name: string): string | null {
  return aspects.find((a) => a.name === name)?.value ?? null;
}

function extractSize(aspects: EbayAspect[]): string {
  return extractAspect(aspects, "Size") ?? extractAspect(aspects, "US Size") ?? "";
}

function normalizeEbay(item: Record<string, unknown>): Listing {
  const price = item.price as { value: string; currency: string };
  const aspects = (item.localizedAspects as EbayAspect[]) ?? [];
  const image = item.image as { imageUrl: string } | undefined;

  return {
    id: item.itemId as string,
    platform: "ebay",
    title: item.title as string,
    description: (item.shortDescription as string) ?? "",
    price: parseFloat(price.value),
    currency: price.currency,
    size: extractSize(aspects),
    brand: extractAspect(aspects, "Brand"),
    url: item.itemWebUrl as string,
    imageUrl: image?.imageUrl ?? null,
    listedAt: item.itemCreationDate
      ? new Date(item.itemCreationDate as string)
      : null,
    condition: (item.condition as string) ?? null,
    raw: item,
  };
}
```

## Rate Limits

- The free tier allows 5,000 calls a day. Personal use never gets close to that limit.
- No delay is needed between requests at this volume.

## Notes

- eBay has turned up the best inventory for Allen Edmonds shoes and Dale of Norway sweaters so far.
- eBay's size data is inconsistent, so filter loosely at the API level and let the LLM (the scoring model that rates each listing) judge fit.
- `shortDescription` is often empty. The LLM relies mainly on title and brand for eBay listings.
