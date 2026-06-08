# Platform: Poshmark

## Status: Ready — Playwright headless browser

## Access Method

Poshmark has no public API and blocks simple HTTP requests. Requires headless browser automation. Playwright with Chromium works reliably at personal volume.

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

**Note:** Poshmark's DOM selectors change periodically. If scraper breaks, inspect current DOM and update selectors. This is the main maintenance burden for this platform.

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

Reuse a browser profile across runs to maintain cookies and avoid re-fingerprinting:

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

On a static home IP (unlike rotating GitHub Actions IPs), Poshmark can fingerprint over time.

- Use `playwright-extra` + `puppeteer-extra-plugin-stealth` to reduce headless signals:
  ```typescript
  import { chromium } from "playwright-extra";
  import StealthPlugin from "puppeteer-extra-plugin-stealth";
  chromium.use(StealthPlugin());
  ```
- Run Poshmark every 3h, not every 60 min — lower request rate, less exposure
- Rotate user-agent string per session

## Docker Deployment (Synology NAS)

Use the official Playwright Docker image — Chromium is pre-installed:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

CMD ["node", "dist/main.js", "--platforms", "poshmark"]
```

**Critical flags** already included in `getPersistentContext()` above:
- `--no-sandbox` — required in Docker (no kernel namespace)
- `--disable-dev-shm-usage` — container `/dev/shm` is 64MB by default, Chromium needs more

## Schedule

Run Poshmark container on 3h cycle via Synology Task Scheduler. Other platforms (eBay, Grailed, Vestiaire, Depop) run every 60 min in main container. Same DB, different trigger schedules.

## Notes

- Poshmark has strong US inventory — good for finding eBay-type deals
- Brand data often missing or user-entered — inconsistent quality
- Description not available at search level — LLM scores on title + brand only; higher MAYBE rate expected
- Consider fetching individual listing pages for MAYBE items to get full description before alerting
