import { describe, expect, it, vi } from "vitest";
import { resolvePlatformSearches, DEFAULT_SEARCHES } from "../../src/config/searches.js";
import { configContentHash } from "../../src/storage/repos/config-revisions.js";
import { QueryRunTracker } from "../../src/pipeline/query-stats.js";
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { openDatabase } from "../../src/storage/db.js";
import { ScrapeQueriesRepo } from "../../src/storage/repos/scrape-queries.js";
import { ConfigRevisionsRepo } from "../../src/storage/repos/config-revisions.js";
import { executionId } from "../../src/storage/repos/search-groups.js";
import { mockScraper } from "../helpers/scrapers.js";
import { yesBatchProvider } from "../helpers/mock-provider.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";

describe("search intelligence phase 1", () => {
  it("resolves platform searches from defaults when config omits searches", () => {
    const queries = resolvePlatformSearches(minimalConfig, "depop");
    const groupId = DEFAULT_SEARCHES.depop[0].id;
    expect(queries[0].queryId).toBe(executionId(groupId, "depop"));
    expect(queries[0].sourceQueryId).toBe(groupId);
    expect(queries[0].text).toContain("corduroy");
  });

  it("records query runs and config revision through pipeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      }),
    );

    const groupId = "ebay-test-query";
    const execId = executionId(groupId, "ebay");
    const config = {
      ...minimalConfig,
      searches: {
        ebay: [{ id: groupId, q: "test jacket XXL", status: "active" as const }],
      },
    };
    const db = openDatabase(":memory:");

    await runPipeline({
      config,
      db,
      scrapers: [
        mockScraper(
          "ebay",
          [sampleListing({ platform: "ebay", id: "q1", sourceQueryId: groupId })],
          execId,
          groupId,
        ),
      ],
      provider: yesBatchProvider("Query intel"),
    });

    const scrapeRepo = new ScrapeQueriesRepo(db, "default");
    const scorecard = scrapeRepo.fetchScorecard();
    expect(scorecard.some((r) => r.query_id === execId)).toBe(true);

    const queryRuns = db
      .prepare(`SELECT query_id, group_id, listings_found, alerts_sent FROM scrape_query_runs`)
      .all() as Array<{
      query_id: string;
      group_id: string;
      listings_found: number;
      alerts_sent: number;
    }>;
    expect(queryRuns[0].query_id).toBe(execId);
    expect(queryRuns[0].group_id).toBe(groupId);
    expect(queryRuns[0].alerts_sent).toBe(1);

    const revisions = new ConfigRevisionsRepo(db, "default").fetchRecent(5);
    expect(revisions.length).toBe(1);

    const alert = db
      .prepare(`SELECT source_query_id FROM alert_log WHERE listing_id = 'q1'`)
      .get() as { source_query_id: string };
    expect(alert.source_query_id).toBe(groupId);

    db.close();
    vi.restoreAllMocks();
  });

  it("tracks per-query stats in QueryRunTracker", () => {
    const groupId = "depop-corduroy";
    const listing = sampleListing({ sourceQueryId: groupId });
    const tracker = new QueryRunTracker([
      {
        queryId: executionId(groupId, "depop"),
        groupId,
        queryText: "corduroy",
        platform: "depop",
        ok: true,
        listings: [listing],
      },
    ]);

    tracker.recordNew(listing);
    tracker.recordScore(listing, "YES");
    tracker.recordAlert(listing);

    const row = tracker.toArray()[0];
    expect(row.listingsNew).toBe(1);
    expect(row.scoredYes).toBe(1);
    expect(row.alertsSent).toBe(1);
  });

  it("detects config hash changes", () => {
    const a = configContentHash(minimalConfig);
    const b = configContentHash({
      ...minimalConfig,
      aesthetic_prompt: "Different aesthetic",
    });
    expect(a).not.toBe(b);
  });
});
