import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { minimalConfig } from "../helpers/fixtures.js";
import type { Listing } from "../../src/core/types.js";

const fetchMock = vi.fn();
const impitConstructor = vi.fn();

vi.mock("impit", () => ({
  Impit: class MockImpit {
    fetch = fetchMock;
    constructor(...args: unknown[]) {
      impitConstructor(...args);
    }
  },
}));

const extractDepopListingsFromHtml = vi.fn();
const extractDepopSearchFromHtml = vi.fn();

vi.mock("../../src/platforms/depop/parse-rsc.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platforms/depop/parse-rsc.js")>();
  return { ...actual, extractDepopListingsFromHtml, extractDepopSearchFromHtml };
});

const { DepopScraper } = await import("../../src/platforms/depop/scraper.js");

function sampleListing(): Listing {
  return {
    id: "1",
    platform: "depop",
    title: "Corduroy jacket",
    description: "",
    price: 45,
    currency: "USD",
    size: "L",
    brand: null,
    url: "https://www.depop.com/products/1/",
    imageUrl: null,
    listedAt: null,
    condition: null,
    raw: {},
  };
}

describe("DepopScraper.searchViaHttp", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    impitConstructor.mockReset();
    extractDepopListingsFromHtml.mockReset();
    extractDepopSearchFromHtml.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns listings on the first attempt when the response is ok and has products", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "<html></html>" });
    extractDepopListingsFromHtml.mockReturnValue([sampleListing()]);
    extractDepopSearchFromHtml.mockReturnValue({ meta: { total_count: 1 } });

    const scraper = new DepopScraper(minimalConfig);
    const listings = await scraper.searchViaHttp("corduroy jacket");

    expect(listings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on a non-ok response and succeeds on the second attempt", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "<html></html>" });
    extractDepopListingsFromHtml.mockReturnValue([sampleListing()]);

    const scraper = new DepopScraper(minimalConfig);
    const resultPromise = scraper.searchViaHttp("corduroy jacket");
    await vi.runAllTimersAsync();
    const listings = await resultPromise;

    expect(listings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when the response is ok but has no extractable products", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "<html></html>" });
    extractDepopListingsFromHtml.mockReturnValue([]);

    const scraper = new DepopScraper(minimalConfig);
    const assertion = expect(scraper.searchViaHttp("corduroy jacket")).rejects.toThrow(
      "Depop search HTML missing embedded product payload",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws the last HTTP error message after exhausting all 3 attempts", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "" });

    const scraper = new DepopScraper(minimalConfig);
    const assertion = expect(scraper.searchViaHttp("corduroy jacket")).rejects.toThrow(
      "Depop search HTTP 503",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("lazily constructs the impit client once and reuses it across repeated calls", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "<html></html>" });
    extractDepopListingsFromHtml.mockReturnValue([sampleListing()]);

    const scraper = new DepopScraper(minimalConfig);
    expect(impitConstructor).not.toHaveBeenCalled();

    await scraper.searchViaHttp("first query");
    await scraper.searchViaHttp("second query");

    expect(impitConstructor).toHaveBeenCalledTimes(1);
    expect(impitConstructor).toHaveBeenCalledWith({ browser: "firefox" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
