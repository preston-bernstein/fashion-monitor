import type { BrowserContext } from "playwright";
import type { Config } from "../../core/config.js";
import type { Listing } from "../../core/types.js";
import type { SearchRequest } from "../../config/searches.js";
import { closeAllStealthBrowsers, launchStealthPersistentContext } from "../playwright/browser.js";
import { scrapeQueries } from "../scrape-utils.js";
import type { PlatformScraper, ScrapeOutcome } from "../types.js";
import { poshmarkTileExtractScript } from "./extract.js";
import { parsePoshmarkTiles } from "./normalize.js";

export async function getPoshmarkContext(profilePath: string): Promise<BrowserContext> {
  return launchStealthPersistentContext(profilePath);
}

export async function scrapePoshmarkQuery(
  context: BrowserContext,
  query: string,
): Promise<Listing[]> {
  const params = new URLSearchParams({
    query,
    department: "Men",
    sort_by: "added_desc",
  });
  params.append("size[]", "XL");
  params.append("size[]", "XXL");
  params.append("size[]", "2XL");

  const page = await context.newPage();
  try {
    await page.goto(`https://poshmark.com/search?${params}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector('a[data-et-prop-location="listing_tile"]', { timeout: 30_000 });
    await page.waitForTimeout(2_000);

    const raw = await page.evaluate(poshmarkTileExtractScript);
    return parsePoshmarkTiles(raw);
  } finally {
    await page.close();
  }
}

export class PoshmarkScraper implements PlatformScraper {
  readonly platform = "poshmark" as const;

  constructor(private readonly config: Config) {}

  async search(queries: SearchRequest[]): Promise<ScrapeOutcome> {
    const context = await getPoshmarkContext(this.config.scraper.poshmark_profile_path);
    try {
      return await scrapeQueries("poshmark", queries, (text) => scrapePoshmarkQuery(context, text));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Poshmark scrape failed";
      return { ok: false, error: message, queryResults: [] };
    }
  }
}

export function createPoshmarkScraper(config: Config): PlatformScraper {
  return new PoshmarkScraper(config);
}

export async function closePoshmarkContext(): Promise<void> {
  await closeAllStealthBrowsers();
}
