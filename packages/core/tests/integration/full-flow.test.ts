import { afterEach, describe, expect, it, vi } from "vitest";
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { yesBatchProvider } from "../helpers/mock-provider.js";
import { mockScraper } from "../helpers/scrapers.js";
import { createTestDb } from "../helpers/db.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("full pipeline flow (real code, fake I/O)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrape → prefilter → score → alert leaves consistent DB state", async () => {
    const { db, config } = createTestDb("fm-flow-");
    const flowConfig = {
      ...config,
      llm: { ...config.llm, provider: "mock" as const },
    };

    let ntfyBody: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input, init) => {
        if (String(input).startsWith(flowConfig.alert.ntfy_url)) {
          ntfyBody = String(init?.body);
          return { ok: true };
        }
        throw new Error(`unexpected fetch: ${input}`);
      }),
    );

    const stats = await runPipeline({
      config: flowConfig,
      db,
      scrapers: [
        mockScraper("ebay", [
          sampleListing({ platform: "ebay", id: "flow-1" }),
          sampleListing({ platform: "ebay", id: "flow-reject", brand: "Zara", price: 15 }),
        ]),
      ],
      provider: yesBatchProvider("Flow verify"),
    });

    const seen = db
      .prepare(`SELECT id, score, alerted_at IS NOT NULL AS alerted FROM seen_listings ORDER BY id`)
      .all() as Array<{ id: string; score: string; alerted: number }>;

    const alerts = db.prepare(`SELECT listing_id, score FROM alert_log`).all();
    const runs = db.prepare(`SELECT alerts_sent, error FROM runs`).all();

    db.close();

    expect(stats).toMatchObject({
      listingsFound: 2,
      prefilterRejected: 1,
      scoredYes: 1,
      alertsSent: 1,
    });
    expect(seen).toEqual([
      { id: "flow-1", score: "YES", alerted: 1 },
      { id: "flow-reject", score: "NO", alerted: 0 },
    ]);
    expect(alerts).toHaveLength(1);
    expect(runs).toEqual([{ alerts_sent: 1, error: null }]);
    const parsedNtfyBody = JSON.parse(ntfyBody ?? "{}");
    expect(parsedNtfyBody.message).toContain("Flow verify");
    expect(parsedNtfyBody.click).toContain("https://example.com/listing");
  });
});
