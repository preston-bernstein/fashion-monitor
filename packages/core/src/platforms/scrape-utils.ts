import type { Listing, Platform } from "../core/types.js";
import { tagListings, type SearchRequest } from "../config/searches.js";
import { LogEvents } from "../lib/log-events.js";
import { createLogger, logError } from "../lib/logging.js";
import type { QueryScrapeResult, ScrapeOutcome } from "./types.js";

export async function scrapeQueries(
  platform: Platform,
  queries: SearchRequest[],
  searchOne: (text: string) => Promise<Listing[]>,
  options?: { betweenQueriesMs?: number },
): Promise<ScrapeOutcome> {
  const log = createLogger(`platform.${platform}`, { platform });
  const queryResults: QueryScrapeResult[] = [];
  const listings: Listing[] = [];
  const errors: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const found = await searchOne(q.text);
      const tagged = tagListings(found, q.queryId);
      queryResults.push({
        queryId: q.queryId,
        queryText: q.text,
        platform,
        ok: true,
        listings: tagged,
      });
      listings.push(...tagged);
      log.debug(LogEvents.PlatformQuerySuccess, { queryId: q.queryId, count: tagged.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : "scrape failed";
      logError(log, LogEvents.PlatformQueryFailed, err, { queryId: q.queryId });
      queryResults.push({
        queryId: q.queryId,
        queryText: q.text,
        platform,
        ok: false,
        listings: [],
        error: message,
      });
      errors.push(`${q.queryId}: ${message}`);
    }

    if (options?.betweenQueriesMs && i < queries.length - 1) {
      await new Promise((r) => setTimeout(r, options.betweenQueriesMs));
    }
  }

  if (listings.length === 0 && errors.length > 0) {
    return { ok: false, error: errors.join("; "), queryResults };
  }

  return { ok: true, listings, queryResults };
}
