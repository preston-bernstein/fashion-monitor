import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { mockScraper } from "../helpers/scrapers.js";
import { yesBatchProvider, unhealthyProvider } from "../helpers/mock-provider.js";
import { createTestDb } from "../helpers/db.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("orchestrator", () => {
  let config: ReturnType<typeof createTestDb>["config"];
  let db: ReturnType<typeof createTestDb>["db"];

  beforeEach(() => {
    const setup = createTestDb("fm-pipe-");
    config = { ...setup.config, llm: { ...setup.config.llm, provider: "mock" } };
    db = setup.db;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it("runs full pipeline with mock scraper and provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      }),
    );

    const stats = await runPipeline({
      config,
      db,
      scrapers: [mockScraper("ebay")],
      provider: yesBatchProvider("Pipeline test"),
    });

    expect(stats.listingsFound).toBe(1);
    expect(stats.scoredYes).toBe(1);
    expect(stats.alertsSent).toBe(1);
  });

  it("marks pending when provider unhealthy", async () => {
    const stats = await runPipeline({
      config,
      db,
      scrapers: [mockScraper("ebay")],
      provider: unhealthyProvider(),
    });

    expect(stats.scoredYes).toBe(0);
    expect(stats.alertsSent).toBe(0);

    const repo = new SeenListingsRepo(db, "default");
    expect(repo.fetchPendingListings()).toHaveLength(1);
  });

  it("scores pending backlog when provider becomes healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      }),
    );

    const listing = sampleListing({ platform: "ebay", id: "pending-1" });

    await runPipeline({
      config,
      db,
      scrapers: [mockScraper("ebay", [listing])],
      provider: unhealthyProvider(),
    });

    const emptyScraper = mockScraper("ebay", []);

    const stats = await runPipeline({
      config,
      db,
      scrapers: [emptyScraper],
      provider: yesBatchProvider("Backlog scored"),
    });

    expect(stats.scoredYes).toBe(1);
    expect(stats.alertsSent).toBe(1);

    const repo = new SeenListingsRepo(db, "default");
    expect(repo.fetchPendingListings()).toHaveLength(0);
  });
});
