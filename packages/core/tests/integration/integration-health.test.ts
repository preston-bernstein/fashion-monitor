import { describe, expect, it, vi } from "vitest";
import { runPipeline } from "../../src/pipeline/orchestrator.js";
import { openDatabase } from "../../src/storage/db.js";
import { IntegrationHealthRepo } from "../../src/storage/repos/integration-health.js";
import { mockScraper } from "../helpers/scrapers.js";
import { yesBatchProvider } from "../helpers/mock-provider.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";
import type { PlatformScraper } from "../../src/platforms/types.js";

function failingScraper(platform: PlatformScraper["platform"]): PlatformScraper {
  return {
    platform,
    async search() {
      return {
        ok: false,
        error: "connection timeout",
        listings: [],
        queryResults: [
          {
            queryId: `${platform}-test`,
            queryText: "test",
            platform,
            ok: false,
            listings: [],
            error: "connection timeout",
          },
        ],
      };
    },
  };
}

describe("integration health metrics", () => {
  it("records scraper ok, llm ok, and alert ok on successful run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      }),
    );

    const db = openDatabase(":memory:");
    await runPipeline({
      config: minimalConfig,
      db,
      scrapers: [mockScraper("depop", [sampleListing({ platform: "depop" })])],
      provider: yesBatchProvider("Health test"),
    });

    const repo = new IntegrationHealthRepo(db, "default");
    const uptime = repo.fetchUptime7d();
    expect(uptime.some((r) => r.integration === "scraper:depop" && r.ok_count >= 1)).toBe(true);
    expect(uptime.some((r) => r.integration === "llm:mock" && r.ok_count >= 1)).toBe(true);
    expect(uptime.some((r) => r.integration === "alerts:ntfy" && r.ok_count >= 1)).toBe(true);

    db.close();
    vi.restoreAllMocks();
  });

  it("records scraper fail and surfaces in recent failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      }),
    );

    const db = openDatabase(":memory:");
    await runPipeline({
      config: minimalConfig,
      db,
      scrapers: [failingScraper("poshmark")],
      provider: yesBatchProvider("No listings"),
    });

    const repo = new IntegrationHealthRepo(db, "default");
    const uptime = repo.fetchUptime7d();
    expect(uptime.some((r) => r.integration === "scraper:poshmark" && r.fail_count >= 1)).toBe(
      true,
    );

    const failures = repo.fetchRecentFailures(10);
    expect(failures.some((f) => f.integration === "scraper:poshmark" && f.status === "fail")).toBe(
      true,
    );

    db.close();
    vi.restoreAllMocks();
  });
});
