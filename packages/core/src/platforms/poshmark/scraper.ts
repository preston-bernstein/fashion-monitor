import type { Config } from "../../core/config.js";
import type { Listing } from "../../core/types.js";
import type { SearchRequest } from "../../config/searches.js";
import { LogEvents } from "../../lib/log-events.js";
import { createLogger, logError } from "../../lib/logging.js";
import { scrapeQueries } from "../scrape-utils.js";
import { closePage, createPage, getContent, navigate } from "../stealth-sidecar/client.js";
import {
  closeAllPersistentContexts,
  getOrCreatePersistentContext,
  pollContent,
} from "../stealth-sidecar/session.js";
import type { PlatformScraper, ScrapeOutcome } from "../types.js";
import { extractPoshmarkTilesFromHtml } from "./extract.js";
import { parsePoshmarkTiles } from "./normalize.js";

const log = createLogger("platform.poshmark", { platform: "poshmark" });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getPoshmarkContext(profilePath: string): Promise<string> {
  return getOrCreatePersistentContext(profilePath);
}

export async function scrapePoshmarkQuery(contextId: string, query: string): Promise<Listing[]> {
  const params = new URLSearchParams({
    query,
    department: "Men",
    sort_by: "added_desc",
  });
  params.append("size[]", "XL");
  params.append("size[]", "XXL");
  params.append("size[]", "2XL");

  const url = `https://poshmark.com/search?${params}`;

  const { pageId } = await createPage(contextId);
  try {
    await navigate(pageId, url);

    await pollContent(pageId, (content) => extractPoshmarkTilesFromHtml(content, url).length > 0, {
      timeoutMs: 30_000,
      intervalMs: 2_000,
    });

    // Fixed settle delay, matching the old page.waitForTimeout(2_000) — taken
    // after tiles are confirmed present, before the final content read below,
    // to give any still-in-flight lazy content a chance to finish rendering.
    await sleep(2_000);

    const html = await getContent(pageId);
    const raw = extractPoshmarkTilesFromHtml(html, url);
    return parsePoshmarkTiles(raw);
  } finally {
    await closePage(pageId);
  }
}

export class PoshmarkScraper implements PlatformScraper {
  readonly platform = "poshmark" as const;

  constructor(private readonly config: Config) {}

  async search(queries: SearchRequest[]): Promise<ScrapeOutcome> {
    try {
      const contextId = await getPoshmarkContext(this.config.scraper.poshmark_profile_path);
      return await scrapeQueries("poshmark", queries, (text) =>
        scrapePoshmarkQuery(contextId, text),
      );
    } catch (err) {
      logError(log, LogEvents.PlatformScrapeFailed, err);
      const message = err instanceof Error ? err.message : "Poshmark scrape failed";
      return { ok: false, error: message, queryResults: [] };
    }
  }
}

export function createPoshmarkScraper(config: Config): PlatformScraper {
  return new PoshmarkScraper(config);
}

export async function closePoshmarkContext(): Promise<void> {
  await closeAllPersistentContexts();
}
