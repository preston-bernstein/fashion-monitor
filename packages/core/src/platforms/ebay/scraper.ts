import type { Config } from "../../core/config.js";
import type { Listing } from "../../core/types.js";
import { fetchJson, fetchWithTimeout } from "../../lib/http.js";
import { LogEvents } from "../../lib/log-events.js";
import { createLogger } from "../../lib/logging.js";
import { scrapeQueries } from "../scrape-utils.js";
import type { PlatformScraper, ScrapeOutcome } from "../types.js";
import type { SearchRequest } from "../../config/searches.js";
import { normalizeEbay } from "./normalize.js";

const log = createLogger("platform.ebay");

interface EbaySearchResponse {
  itemSummaries?: Record<string, unknown>[];
}

interface EbayTokenResponse {
  access_token: string;
  expires_in: number;
}

export class EbayScraper implements PlatformScraper {
  readonly platform = "ebay" as const;
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: Config) {}

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }

    // Prefer the per-profile resolved credential (DB > env > config.yaml —
    // see profile-config.ts); fall back to the raw env var directly for
    // callers that build a Config without going through loadProfileConfig
    // (e.g. scripts/verify-scrapers.ts).
    const clientId = this.config.platform_credentials?.ebay_client_id ?? process.env.EBAY_CLIENT_ID;
    const clientSecret =
      this.config.platform_credentials?.ebay_client_secret ?? process.env.EBAY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET required");
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetchWithTimeout("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
    });

    if (!response.ok) {
      log.warn(LogEvents.PlatformEbayOAuthFailed, { status: response.status });
      throw new Error(`eBay OAuth failed: ${response.status}`);
    }

    const data = (await response.json()) as EbayTokenResponse;
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  private async searchQuery(query: string): Promise<Listing[]> {
    const token = await this.getToken();
    const params = new URLSearchParams({
      q: query,
      category_ids: "57988",
      filter: "itemLocationCountry:US,conditions:{USED|NEW}",
      sort: "newlyListed",
      limit: "50",
    });

    const data = await fetchJson<EbaySearchResponse>(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
      },
    );

    return (data.itemSummaries ?? []).map((item) => normalizeEbay(item));
  }

  async search(queries: SearchRequest[]): Promise<ScrapeOutcome> {
    return scrapeQueries("ebay", queries, (text) => this.searchQuery(text));
  }
}

export function createEbayScraper(config: Config): PlatformScraper {
  return new EbayScraper(config);
}
