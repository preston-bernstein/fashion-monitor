import { describe, expect, it, vi, afterEach } from "vitest";
import { createGrailedScraper } from "../../src/platforms/grailed/scraper.js";
import { minimalConfig } from "../helpers/fixtures.js";
import grailedFixture from "../fixtures/grailed/algolia-response.json";
import type { SearchRequest } from "../../src/config/searches.js";

function configWithCredentials() {
  return {
    ...minimalConfig,
    platform_credentials: { grailed_app_id: "ABC123", grailed_api_key: "secret-key" },
  };
}

function query(overrides: Partial<SearchRequest> = {}): SearchRequest {
  return {
    queryId: "corduroy@grailed",
    text: "corduroy jacket",
    sourceQueryId: "corduroy",
    ...overrides,
  };
}

describe("GrailedScraper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches Algolia and returns normalized listings tagged with the source query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => grailedFixture,
      }),
    );

    const scraper = createGrailedScraper(configWithCredentials());
    const result = await scraper.search([query()]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.listings).toHaveLength(grailedFixture.hits.length);
    expect(result.listings[0].platform).toBe("grailed");
    expect(result.listings[0].sourceQueryId).toBe("corduroy");
    expect(result.queryResults[0]).toMatchObject({ ok: true, queryId: "corduroy@grailed" });
  });

  it("rejects outright when credentials are missing (search() has no try/catch around validation)", async () => {
    const scraper = createGrailedScraper(minimalConfig);
    await expect(scraper.search([query()])).rejects.toThrow(
      "GRAILED_APP_ID and GRAILED_API_KEY required",
    );
  });

  it("returns ok:false with the query's error when Algolia responds with a non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      }),
    );

    const scraper = createGrailedScraper(configWithCredentials());
    const result = await scraper.search([query()]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Grailed Algolia failed: 401");
    expect(result.queryResults[0]).toMatchObject({ ok: false });
  });

  it("passes through query text, page, and filter shape to the Algolia request body", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hits: [] }),
    });
    vi.stubGlobal("fetch", fetchFn);

    const scraper = createGrailedScraper(configWithCredentials());
    await scraper.search([query({ text: "wool coat" })]);

    const [, init] = fetchFn.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.query).toBe("wool coat");
    expect(body.hitsPerPage).toBe(40);
  });
});
