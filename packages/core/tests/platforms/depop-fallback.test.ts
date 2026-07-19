import { describe, expect, it, vi, beforeEach } from "vitest";
import { mapDepopProducts } from "../../src/platforms/depop/normalize.js";
import { DepopScraper } from "../../src/platforms/depop/scraper.js";
import { minimalConfig } from "../helpers/fixtures.js";
import depopFixture from "../fixtures/depop/search-response.json";

vi.mock("../../src/platforms/depop/playwright-fallback.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/platforms/depop/playwright-fallback.js")>();
  return {
    ...actual,
    scrapeDepopViaPlaywright: vi.fn(),
  };
});

import { scrapeDepopViaPlaywright } from "../../src/platforms/depop/playwright-fallback.js";

describe("depop playwright fallback", () => {
  beforeEach(() => {
    vi.mocked(scrapeDepopViaPlaywright).mockReset();
  });

  it("parses intercepted API JSON", () => {
    const listings = mapDepopProducts(depopFixture.objects ?? []);
    expect(listings[0].platform).toBe("depop");
  });

  it("falls back to playwright when impit HTTP fails", async () => {
    const scraper = new DepopScraper(minimalConfig);
    const mockListing = mapDepopProducts(depopFixture.objects ?? [])[0];

    vi.spyOn(scraper, "searchViaHttp").mockRejectedValue(new Error("missing payload"));
    vi.mocked(scrapeDepopViaPlaywright).mockResolvedValue([mockListing]);

    const listings = await scraper.searchQuery("test");
    expect(listings).toHaveLength(1);
    expect(scrapeDepopViaPlaywright).toHaveBeenCalledWith("test");
  });
});
