import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runScrapePhase, runScorePhase } from "../../src/pipeline/orchestrator.js";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { mockScraper } from "../helpers/scrapers.js";
import { yesBatchProvider, unhealthyProvider } from "../helpers/mock-provider.js";
import { createTestDb } from "../helpers/db.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("orchestrator — scrape/score split", () => {
  let config: ReturnType<typeof createTestDb>["config"];
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(() => {
    const setup = createTestDb("fm-pipe-split-");
    config = { ...setup.config, llm: { ...setup.config.llm, provider: "mock" } };
    db = setup.db;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("runScrapePhase never touches the LLM provider and marks passed listings PENDING", async () => {
    const provider = unhealthyProvider();
    const healthCheckSpy = vi.spyOn(provider, "healthCheck");

    const stats = await runScrapePhase({
      config,
      db,
      scrapers: [mockScraper("ebay")],
      provider,
    });

    expect(healthCheckSpy).not.toHaveBeenCalled();
    expect(stats.listingsFound).toBe(1);
    expect(stats.listingsNew).toBe(1);
    expect(stats.scoredYes).toBe(0);
    expect(stats.alertsSent).toBe(0);

    const repo = new SeenListingsRepo(db, "default");
    expect(repo.fetchPendingListings()).toHaveLength(1);
  });

  it("runScorePhase scores whatever runScrapePhase left PENDING and dispatches alerts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      }),
    );

    const listing = sampleListing({ platform: "ebay", id: "split-pending-1" });
    await runScrapePhase({ config, db, scrapers: [mockScraper("ebay", [listing])] });

    const scoreStats = await runScorePhase({
      config,
      db,
      provider: yesBatchProvider("Split score test"),
    });

    expect(scoreStats.scoredYes).toBe(1);
    expect(scoreStats.alertsSent).toBe(1);
    expect(scoreStats.listingsFound).toBe(0);
    expect(scoreStats.listingsNew).toBe(0);

    const repo = new SeenListingsRepo(db, "default");
    expect(repo.fetchPendingListings()).toHaveLength(0);
  });

  it("runScorePhase is a clean no-op (not an error) when the provider is unhealthy and the backlog is untouched", async () => {
    const listing = sampleListing({ platform: "ebay", id: "split-pending-2" });
    await runScrapePhase({ config, db, scrapers: [mockScraper("ebay", [listing])] });

    const stats = await runScorePhase({ config, db, provider: unhealthyProvider() });

    expect(stats.scoredYes).toBe(0);
    expect(stats.alertsSent).toBe(0);
    expect(stats.errors).toHaveLength(0);

    const repo = new SeenListingsRepo(db, "default");
    expect(repo.fetchPendingListings()).toHaveLength(1);
  });
});
