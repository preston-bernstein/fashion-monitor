import type { Config } from "../../core/config.js";
import type { Listing } from "../../core/types.js";
import type { SearchRequest } from "../../config/searches.js";
import { scrapeQueries } from "../scrape-utils.js";
import type { PlatformScraper, ScrapeOutcome } from "../types.js";
import { fetchVestiaireHtml, VestiaireRedirectError } from "./fetch-page.js";
import { normalizeVestiaire } from "./normalize.js";
import { extractVestiaireProductsFromHtml } from "./parse-html.js";

export { extractVestiaireProductsFromHtml };

export class VestiaireScraper implements PlatformScraper {
  readonly platform = "vestiaire" as const;

  constructor(private readonly _config: Config) {}

  private buildSearchUrl(query: string): string {
    const params = new URLSearchParams({
      q: query,
      universe: "M",
      priceMax: "300",
      order: "publishedDate",
    });
    params.append("size", "XL");
    params.append("size", "XXL");
    return `https://www.vestiairecollective.com/search/?${params}`;
  }

  private async searchQuery(text: string): Promise<Listing[]> {
    const url = this.buildSearchUrl(text);
    try {
      const html = await fetchVestiaireHtml(url);
      const products = extractVestiaireProductsFromHtml(html);
      return products.map((item) => normalizeVestiaire(item));
    } catch (err) {
      if (err instanceof VestiaireRedirectError) return [];
      throw err;
    }
  }

  async search(queries: SearchRequest[]): Promise<ScrapeOutcome> {
    return scrapeQueries("vestiaire", queries, (text) => this.searchQuery(text), {
      betweenQueriesMs: 2500,
    });
  }
}

export function createVestiaireScraper(config: Config): PlatformScraper {
  return new VestiaireScraper(config);
}
