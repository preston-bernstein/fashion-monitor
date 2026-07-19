import type { Config } from "../../core/config.js";
import type { Listing } from "../../core/types.js";
import { LogEvents } from "../../lib/log-events.js";
import { createLogger } from "../../lib/logging.js";
import type { SearchRequest } from "../../config/searches.js";
import { scrapeQueries } from "../scrape-utils.js";
import type { PlatformScraper, ScrapeOutcome } from "../types.js";
import { fetchDepopViaScrapfly } from "./fetch-scrapfly.js";
import { parseDepopProducts } from "./normalize.js";
import { buildDepopProductsApiUrl, type DepopProductsApiResponse } from "./parse-rsc.js";
import { scrapeDepopViaPlaywright } from "./playwright-fallback.js";

const log = createLogger("platform.depop");

/**
 * Strict Cloudflare-challenge detection: both the status code AND both headers
 * must be present. A bare body-text match is never sufficient on its own — see
 * spec/platforms/depop.md for why this must stay this narrow (a looser rule
 * would misroute ordinary non-Cloudflare failures into the shared, budget
 * -limited ScrapFly quota).
 */
function isDepopCloudflareChallenge(response: {
  status: number;
  headers: { get(name: string): string | null };
}): boolean {
  return (
    (response.status === 403 || response.status === 429) &&
    response.headers.get("server") === "cloudflare" &&
    Boolean(response.headers.get("cf-ray"))
  );
}

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

  /**
   * One-shot ScrapFly escalation for a detected Cloudflare challenge — not
   * part of the primary tier's retry loop. fetchDepopViaScrapfly already logs
   * PlatformDepopScrapflyFailed with a sanitized message on failure, so this
   * just rethrows for searchQuery's catch to trigger the Playwright fallback.
   */
  private async escalateToScrapfly(url: string): Promise<Listing[]> {
    const scrapflyKey = this._config.platform_credentials?.scrapfly_api_key;
    const json = (await fetchDepopViaScrapfly(url, scrapflyKey)) as DepopProductsApiResponse;
    const listings = parseDepopProducts(json);
    log.info(LogEvents.PlatformDepopScrapflySuccess, { count: listings.length });
    return listings;
  }

  async searchViaHttp(query: string): Promise<Listing[]> {
    const client = await this.getClient();
    const url = buildDepopProductsApiUrl(query);
    // Always overwritten before the loop can exit without a real response
    // (every iteration either returns early or reassigns this below) — this
    // placeholder only guards against an unreachable zero-iteration case.
    let lastError = "Depop search failed with no response";

    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await client.fetch(url, {
        headers: {
          Referer: "https://www.depop.com/",
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const json = (await response.json()) as DepopProductsApiResponse;
        const listings = parseDepopProducts(json);
        if (listings.length > 0) {
          log.info(LogEvents.PlatformDepopHttpSuccess, { count: listings.length, attempt });
        }
        // A 2xx with zero listings is a legitimate "no results" for this
        // query, not a broken extraction — return it as-is rather than
        // retrying or falling back to Playwright.
        return listings;
      }

      if (isDepopCloudflareChallenge(response)) {
        log.warn(LogEvents.PlatformDepopCloudflareChallenge, {
          status: response.status,
          attempt,
        });
        // Ends the searchViaHttp call entirely, success or failure — no
        // further plain-HTTP attempts run after a Cloudflare escalation.
        return this.escalateToScrapfly(url);
      }

      lastError = `Depop search HTTP ${response.status}`;

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
        log.warn(LogEvents.PlatformDepopFallbackFailed, { error: message });
        throw new Error("Depop Playwright fallback returned no listings", { cause: httpErr });
      }
      log.info(LogEvents.PlatformDepopFallbackSuccess, { count: listings.length });
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
