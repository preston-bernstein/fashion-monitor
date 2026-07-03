import type { Config } from "../../core/config.js";
import type { Listing } from "../../core/types.js";
import { LogEvents } from "../../lib/log-events.js";
import { createLogger } from "../../lib/logging.js";
import type { SearchRequest } from "../../config/searches.js";
import { scrapeQueries } from "../scrape-utils.js";
import type { PlatformScraper, ScrapeOutcome } from "../types.js";
import { queryGrailedAlgolia } from "./algolia.js";
import { getGrailedCredentials, validateGrailedCredentials } from "./env.js";
import { normalizeGrailed } from "./normalize.js";

const log = createLogger("platform.grailed");

export class GrailedScraper implements PlatformScraper {
  readonly platform = "grailed" as const;
  private credentialsValidated = false;

  constructor(private readonly _config: Config) {}

  private async ensureCredentialsValid(): Promise<void> {
    if (this.credentialsValidated) return;
    await validateGrailedCredentials();
    this.credentialsValidated = true;
    log.info(LogEvents.PlatformGrailedCredentialsValid);
  }

  private async searchQuery(query: string): Promise<Listing[]> {
    const data = await queryGrailedAlgolia(
      {
        query,
        hitsPerPage: 40,
        page: 0,
        facetFilters: [
          ["category_path:tops", "category_path:outerwear"],
          ["size:L", "size:XL", "size:XXL", "size:2XL", "size:One Size"],
        ],
        numericFilters: ["price_i <= 300"],
      },
      getGrailedCredentials(),
    );

    return (data.hits ?? []).map((hit) => normalizeGrailed(hit));
  }

  async search(queries: SearchRequest[]): Promise<ScrapeOutcome> {
    await this.ensureCredentialsValid();
    return scrapeQueries("grailed", queries, (text) => this.searchQuery(text), {
      betweenQueriesMs: 500,
    });
  }
}

export function createGrailedScraper(config: Config): PlatformScraper {
  return new GrailedScraper(config);
}
