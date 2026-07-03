import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { minimalConfig } from "../helpers/fixtures.js";
import type { SearchRequest } from "../../src/config/searches.js";

const fetchVestiaireHtml = vi.fn();

vi.mock("../../src/platforms/vestiaire/fetch-page.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platforms/vestiaire/fetch-page.js")>();
  return { ...actual, fetchVestiaireHtml };
});

const { createVestiaireScraper } = await import("../../src/platforms/vestiaire/scraper.js");
const { VestiaireRedirectError } = await import("../../src/platforms/vestiaire/fetch-page.js");

const searchPageHtml = readFileSync(
  join(process.cwd(), "tests/fixtures/vestiaire/search-page.html"),
  "utf8",
);

function query(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    queryId: "wool@vestiaire",
    text: "wool coat",
    sourceQueryId: "wool",
    ...overrides,
  };
}

describe("VestiaireScraper", () => {
  beforeEach(() => {
    fetchVestiaireHtml.mockReset();
  });

  it("fetches, extracts, and normalizes products from a search page", async () => {
    fetchVestiaireHtml.mockResolvedValue(searchPageHtml);
    const scraper = createVestiaireScraper(minimalConfig);

    const result = await scraper.search([query()]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].brand).toBe("Brunello Cucinelli");
    expect(result.listings[0].sourceQueryId).toBe("wool");
  });

  it("builds a search URL with universe/price/order and doubled size params", async () => {
    fetchVestiaireHtml.mockResolvedValue(searchPageHtml);
    const scraper = createVestiaireScraper(minimalConfig);
    await scraper.search([query({ text: "denim jacket" })]);

    const [url] = fetchVestiaireHtml.mock.calls[0];
    expect(url).toContain("https://www.vestiairecollective.com/search/?");
    expect(url).toContain("q=denim+jacket");
    expect(url).toContain("universe=M");
    expect(url).toContain("priceMax=300");
    const sizeMatches = [...(url as string).matchAll(/size=/g)];
    expect(sizeMatches).toHaveLength(2);
  });

  it("passes the resolved ScrapFly key through to fetchVestiaireHtml", async () => {
    fetchVestiaireHtml.mockResolvedValue(searchPageHtml);
    const config = {
      ...minimalConfig,
      platform_credentials: { scrapfly_api_key: "sf-key-123" },
    };
    const scraper = createVestiaireScraper(config);
    await scraper.search([query()]);

    const [, deps] = fetchVestiaireHtml.mock.calls[0];
    expect(deps).toEqual({ scrapflyApiKey: "sf-key-123" });
  });

  it("treats a redirect (item removed) as zero listings for that query, not a failure", async () => {
    fetchVestiaireHtml.mockRejectedValue(new VestiaireRedirectError());
    const scraper = createVestiaireScraper(minimalConfig);

    const result = await scraper.search([query()]);

    // searchQuery swallows VestiaireRedirectError and returns [] rather than
    // throwing, so scrapeQueries records a successful (empty) query result -
    // this is a real query returning nothing, not an error.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.listings).toEqual([]);
    expect(result.queryResults[0]).toMatchObject({ ok: true, listings: [] });
  });

  it("propagates a non-redirect fetch error as a failed query", async () => {
    fetchVestiaireHtml.mockRejectedValue(new Error("ScrapFly quota exceeded"));
    const scraper = createVestiaireScraper(minimalConfig);

    const result = await scraper.search([query()]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("ScrapFly quota exceeded");
    expect(result.queryResults[0]).toMatchObject({ ok: false });
  });
});
