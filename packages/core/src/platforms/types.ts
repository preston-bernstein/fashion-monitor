import type { Platform, Listing } from "../core/types.js";
import type { SearchRequest } from "../config/searches.js";

export interface QueryScrapeResult {
  queryId: string;
  queryText: string;
  platform: Platform;
  ok: boolean;
  listings: Listing[];
  error?: string;
}

export type ScrapeOutcome =
  | { ok: true; listings: Listing[]; queryResults: QueryScrapeResult[] }
  | { ok: false; error: string; queryResults: QueryScrapeResult[] };

export interface PlatformScraper {
  readonly platform: Platform;
  search(queries: SearchRequest[]): Promise<ScrapeOutcome>;
}
