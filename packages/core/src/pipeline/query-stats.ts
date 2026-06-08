import type { Listing, Platform } from "../core/types.js";
import type { QueryRunStats } from "../storage/repos/scrape-queries.js";
import type { QueryScrapeResult } from "../platforms/types.js";

function emptyStats(result: QueryScrapeResult): QueryRunStats {
  return {
    queryId: result.queryId,
    platform: result.platform,
    queryText: result.queryText,
    listingsFound: result.ok ? result.listings.length : 0,
    listingsNew: 0,
    scoredYes: 0,
    scoredMaybe: 0,
    scoredNo: 0,
    prefilterRejected: 0,
    alertsSent: 0,
    error: result.ok ? null : (result.error ?? "scrape failed"),
  };
}

export class QueryRunTracker {
  private readonly stats = new Map<string, QueryRunStats>();

  constructor(queryResults: QueryScrapeResult[]) {
    for (const result of queryResults) {
      this.stats.set(result.queryId, emptyStats(result));
    }
  }

  private get(queryId: string | undefined): QueryRunStats | undefined {
    if (!queryId) return undefined;
    return this.stats.get(queryId);
  }

  recordNew(listing: Listing): void {
    const row = this.get(listing.sourceQueryId);
    if (row) row.listingsNew++;
  }

  recordPrefilterRejected(listing: Listing): void {
    const row = this.get(listing.sourceQueryId);
    if (row) row.prefilterRejected++;
  }

  recordScore(listing: Listing, score: "YES" | "MAYBE" | "NO"): void {
    const row = this.get(listing.sourceQueryId);
    if (!row) return;
    if (score === "YES") row.scoredYes++;
    else if (score === "MAYBE") row.scoredMaybe++;
    else row.scoredNo++;
  }

  recordAlert(listing: Listing): void {
    const row = this.get(listing.sourceQueryId);
    if (row) row.alertsSent++;
  }

  toArray(): QueryRunStats[] {
    return [...this.stats.values()];
  }
}

export function platformFromScrapers(scrapers: { platform: Platform }[]): Platform[] {
  return scrapers.map((s) => s.platform);
}
