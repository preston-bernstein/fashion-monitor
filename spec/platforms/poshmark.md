# Platform: Poshmark

## Status: Ready — Playwright headless browser

Poshmark is a secondhand-clothing marketplace app. It has no public API and blocks plain HTTP requests, so this scraper drives a real browser instead, using Playwright (a library that automates Chromium, Firefox, and other browsers).

## Access Method

Poshmark blocks plain HTTP requests, so the scraper needs headless browser automation: a real browser running without a visible window. Playwright with Chromium works reliably at personal volume.

## Dependencies

```bash
npm install playwright
npx playwright install chromium
```

## Search URL Pattern

```
https://poshmark.com/search?query=corduroy+jacket+dark&department=Men&size[]=XXL&sort_by=added_desc
```

## Implementation

```typescript
import { chromium, BrowserContext } from "playwright";

async function scrapePoshmark(query: string): Promise<Listing[]> {
  const context = await getPersistentContext(); // reuse profile across runs

  const params = new URLSearchParams({
    query,
    department: "Men",
    sort_by: "added_desc",
  });
  // Note: size[] param requires array syntax — URLSearchParams handles encoding
  params.append("size[]", "XL");
  params.append("size[]", "XXL");
  params.append("size[]", "2XL");

  const page = await context.newPage();
  await page.goto(`https://poshmark.com/search?${params}`, {
    waitUntil: "networkidle",
  });

  await page.waitForSelector("[data-et-name='listing_tile']", { timeout: 10000 });
  await page.waitForTimeout(3000 + Math.random() * 2000); // anti-detection pause

  const raw = await page.evaluate(() => {
    const tiles = document.querySelectorAll('[data-et-name="listing_tile"]');
    return Array.from(tiles).map((tile) => ({
      id: (tile as HTMLElement).dataset.listingId ?? "",
      title: tile.querySelector(".title")?.textContent?.trim() ?? "",
      price: tile.querySelector(".price")?.textContent?.trim() ?? "",
      brand: tile.querySelector(".brand")?.textContent?.trim() ?? null,
      size: tile.querySelector(".size")?.textContent?.trim() ?? "",
      url: (tile.querySelector("a") as HTMLAnchorElement)?.href ?? "",
      image: (tile.querySelector("img") as HTMLImageElement)?.src ?? null,
    }));
  });

  await page.close();
  return raw.map(normalizePoshmark);
}
```

**Note:** Poshmark's DOM selectors (the CSS patterns the scraper uses to find each listing tile in the page's DOM — the browser's in-memory tree of HTML elements) change periodically. If the scraper breaks, inspect the current DOM in a browser and update the selectors. This is the main maintenance burden for this platform.

## Response Normalization

```typescript
function normalizePoshmark(item: {
  id: string; title: string; price: string;
  brand: string | null; size: string; url: string; image: string | null;
}): Listing {
  const price = parseFloat(item.price.replace(/[^\d.]/g, "") || "0");

  return {
    id: item.id,
    platform: "poshmark",
    title: item.title,
    description: item.title,  // No description at list level
    price,
    currency: "USD",
    size: item.size,
    brand: item.brand,
    url: item.url,
    imageUrl: item.image,
    listedAt: null,            // Not available at list level
    condition: null,           // Not available at list level
    raw: item,
  };
}
```

## Persistent Browser Context

The scraper reuses one browser profile across runs, so it keeps the same cookies and doesn't look like a brand-new visitor every time:

```typescript
import { chromium, BrowserContext } from "playwright";

let _context: BrowserContext | null = null;

async function getPersistentContext(): Promise<BrowserContext> {
  if (_context) return _context;

  _context = await chromium.launchPersistentContext(
    "/data/poshmark-profile",  // NAS volume mount — persists between container runs
    {
      headless: true,
      args: [
        "--no-sandbox",            // required in Docker
        "--disable-dev-shm-usage", // /dev/shm too small in Docker
        "--disable-gpu",           // NAS has no GPU
      ],
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
  );
  return _context;
}
```

## Anti-Detection

This scraper runs from a static home IP address, not a rotating IP like GitHub Actions uses. That means Poshmark can build up a fingerprint (a profile of this traffic's patterns) over time.

- Use `playwright-extra` + `puppeteer-extra-plugin-stealth` to reduce headless signals:
  ```typescript
  import { chromium } from "playwright-extra";
  import StealthPlugin from "puppeteer-extra-plugin-stealth";
  chromium.use(StealthPlugin());
  ```
- Run Poshmark every 3 hours instead of every 60 minutes, to keep the request rate low and reduce exposure.
- Rotate the user-agent string every session.

## Docker Deployment (Synology NAS)

This deploys on a Synology NAS (a network-attached storage box) via Docker. Use the official Playwright Docker image, which comes with Chromium pre-installed:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

CMD ["node", "dist/main.js", "--platforms", "poshmark"]
```

The `getPersistentContext()` function above already includes two flags Docker requires:
- `--no-sandbox` — required in Docker (no kernel namespace)
- `--disable-dev-shm-usage` — container `/dev/shm` is 64MB by default, Chromium needs more

## Schedule

The Poshmark container runs on a 3-hour cycle, triggered by Synology's Task Scheduler. The other platforms (eBay, Grailed, Vestiaire, Depop) run every 60 minutes in the main container. All platforms write to the same database, just on different trigger schedules.

## Notes

- Poshmark has strong US inventory, good for finding eBay-type deals.
- Brand data is often missing, or entered by the seller by hand, so quality is inconsistent.
- Listing descriptions aren't available at the search level. The LLM (the scoring model that rates each listing) scores on title and brand only, so expect a higher MAYBE rate (the fallback score when it can't decide clearly).
- Consider fetching the full page for individual MAYBE-scored items, to get the real description before sending an alert.
