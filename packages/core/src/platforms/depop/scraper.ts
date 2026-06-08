import type { Config } from "../../core/config.js";
import type { Listing } from "../../core/types.js";
import { LogEvents } from "../../lib/log-events.js";
import { createLogger } from "../../lib/logging.js";
import type { SearchRequest } from "../../config/searches.js";
import { scrapeQueries } from "../scrape-utils.js";
import type { PlatformScraper, ScrapeOutcome } from "../types.js";
import {
  buildDepopSearchUrl,
  extractDepopListingsFromHtml,
  extractDepopSearchFromHtml,
} from "./parse-rsc.js";
import { scrapeDepopViaPlaywright } from "./playwright-fallback.js";

const log = createLogger("platform.depop");

export class DepopScraper implements PlatformScraper {
  readonly platform = "depop" as const;
  private impitClient: InstanceType<typeof import("impit").Impit> | null = null;

  constructor(private readonly _config: Config) {}

  private async getClient(): Promise<InstanceType<typeof import("impit").Impit>> {
    if (this.impitClient) return this.impitClient;
    const { Impit } = await import("impit");
    this.impitClient = new Impit({ browser: "firefox" });
    return this.impitClient;
  }

  async searchViaHttp(query: string): Promise<Listing[]> {
    const client = await this.getClient();
    const url = buildDepopSearchUrl(query);
    let lastError = "Depop search HTML missing embedded product payload";

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await client.fetch(url, {
        headers: {
          Referer: "https://www.depop.com/",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      if (!response.ok) {
        lastError = `Depop search HTTP ${response.status}`;
      } else {
        const html = await response.text();
        const listings = extractDepopListingsFromHtml(html);
        if (listings.length > 0) {
          const payload = extractDepopSearchFromHtml(html);
          log.info(LogEvents.PlatformDepopRscSuccess, {
            count: listings.length,
            total: payload?.meta?.total_count,
            attempt,
          });
          return listings;
        }
      }

      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 + attempt * 1000));
      }
    }

    throw new Error(lastError);
  }

  async searchQuery(query: string): Promise<Listing[]> {
    try {
      return await this.searchViaHttp(query);
    } catch (httpErr) {
      const message = httpErr instanceof Error ? httpErr.message : "HTTP failed";
      log.warn(LogEvents.PlatformDepopHttpFailed, { error: message, fallback: "playwright" });
      const listings = await scrapeDepopViaPlaywright(query);
      if (listings.length === 0) {
        throw new Error("Depop Playwright fallback returned no listings", { cause: httpErr });
      }
      return listings;
    }
  }

  async search(queries: SearchRequest[]): Promise<ScrapeOutcome> {
    return scrapeQueries("depop", queries, (text) => this.searchQuery(text));
  }
}

export function createDepopScraper(config: Config): PlatformScraper {
  return new DepopScraper(config);
}

export { parseDepopProducts } from "./normalize.js";
