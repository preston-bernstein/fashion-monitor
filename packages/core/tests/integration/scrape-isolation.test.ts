import { describe, expect, it } from "vitest";
import { scrapeAll } from "../../src/pipeline/orchestrator.js";
import { allPlatformSearches } from "../../src/config/searches.js";
import { mockScraper } from "../helpers/scrapers.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";

describe("scrape failure isolation", () => {
  it("continues when one platform fails", async () => {
    const scrapers = [
      mockScraper("ebay", [sampleListing({ platform: "ebay", id: "ok-1" })]),
      {
        platform: "grailed" as const,
        async search() {
          return { ok: false, error: "Auth expired", queryResults: [] };
        },
      },
      mockScraper("depop", [sampleListing({ platform: "depop", id: "ok-2" })]),
    ];

    const { listings, errors } = await scrapeAll(scrapers, allPlatformSearches(minimalConfig));

    expect(listings).toHaveLength(2);
    expect(errors).toEqual(["grailed: Auth expired"]);
  });
});
