import type { Listing, Platform } from "../core/types.js";
import type { QueryRunStats } from "../storage/repos/scrape-queries.js";
import type { QueryScrapeResult } from "../platforms/types.js";

function emptyStats(result: QueryScrapeResult): QueryRunStats {
  return {
    queryId: result.queryId,
    groupId: result.groupId ?? result.queryId,
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
  private readonly tagToQueryId = new Map<string, string>();

  constructor(queryResults: QueryScrapeResult[]) {
    for (const result of queryResults) {
      this.stats.set(result.queryId, emptyStats(result));
      const tagId = result.groupId ?? result.queryId;
      this.tagToQueryId.set(tagId, result.queryId);
    }
  }

  private getForListing(listing: Listing): QueryRunStats | undefined {
    const tagId = listing.sourceQueryId;
    if (!tagId) return undefined;
    const queryId = this.tagToQueryId.get(tagId) ?? tagId;
    return this.stats.get(queryId);
  }

  recordNew(listing: Listing): void {
    const row = this.getForListing(listing);
    if (row) row.listingsNew++;
  }

  recordPrefilterRejected(listing: Listing): void {
    const row = this.getForListing(listing);
    if (row) row.prefilterRejected++;
  }

  recordScore(listing: Listing, score: "YES" | "MAYBE" | "NO"): void {
    const row = this.getForListing(listing);
    if (!row) return;
    if (score === "YES") row.scoredYes++;
    else if (score === "MAYBE") row.scoredMaybe++;
    else row.scoredNo++;
  }

  recordAlert(listing: Listing): void {
    const row = this.getForListing(listing);
    if (row) row.alertsSent++;
  }

  toArray(): QueryRunStats[] {
    return [...this.stats.values()];
  }
}

export function platformFromScrapers(scrapers: { platform: Platform }[]): Platform[] {
  return scrapers.map((s) => s.platform);
}
