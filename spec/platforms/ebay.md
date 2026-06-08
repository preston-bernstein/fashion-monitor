# Platform: eBay

## Status: Ready — Official API

## Access Method

eBay Browse API (official, documented, free for personal use).

- Docs: developer.ebay.com/api-docs/buy/browse/overview.html
- Auth: OAuth 2.0 Client Credentials flow (app-level, no user login needed)
- Base URL: `https://api.ebay.com/buy/browse/v1/item_summary/search`

## Setup

1. Register at developer.ebay.com
2. Create application → get `App ID` (client ID) and `Cert ID` (client secret)
3. Generate OAuth token:
   ```
   POST https://api.ebay.com/identity/v1/oauth2/token
   grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope
   ```
4. Token valid 2 hours — refresh automatically

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

Run 2-3 queries per session to cover different facets:
- `"men jacket corduroy charcoal black XXL"`
- `"john varvatos helmut lang theory XXL shirt"`
- `"dale norway sweater men XXL wool"`

Results deduplicated by item ID in-memory before DB write.

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

- 5,000 calls/day on free tier — personal use will never approach this
- No delays needed between requests at this volume

## Notes

- eBay has the best inventory for Allen Edmonds shoes and Dale of Norway — user has found good pieces here before
- Size filtering: eBay size data is inconsistent — filter loosely at API level, rely on LLM for fit assessment
- `shortDescription` is often empty; LLM will rely heavily on title and brand for eBay listings
