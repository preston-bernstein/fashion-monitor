import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { minimalConfig } from "../helpers/fixtures.js";
import depopFixture from "../fixtures/depop/search-response.json";
import { buildDepopProductsApiUrl } from "../../src/platforms/depop/parse-rsc.js";

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

vi.mock("../../src/platforms/depop/fetch-scrapfly.js", () => ({
  fetchDepopViaScrapfly: vi.fn(),
}));

import { fetchDepopViaScrapfly } from "../../src/platforms/depop/fetch-scrapfly.js";

const { DepopScraper } = await import("../../src/platforms/depop/scraper.js");

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

describe("DepopScraper.searchViaHttp", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    impitConstructor.mockReset();
    vi.mocked(fetchDepopViaScrapfly).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns listings on the first attempt when the response is ok and has products", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, depopFixture));

    const scraper = new DepopScraper(minimalConfig);
    const listings = await scraper.searchViaHttp("corduroy jacket");

    expect(listings).toHaveLength(depopFixture.objects.length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(buildDepopProductsApiUrl("corduroy jacket"), {
      headers: { Referer: "https://www.depop.com/", Accept: "application/json" },
    });
  });

  it("treats a 429 (not just 403) with Cloudflare headers as a challenge too", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, {}, { server: "cloudflare", "cf-ray": "abc123-ATL" }),
    );
    vi.mocked(fetchDepopViaScrapfly).mockResolvedValue(depopFixture);

    const config = { ...minimalConfig, platform_credentials: { scrapfly_api_key: "sf-key-123" } };
    const scraper = new DepopScraper(config);
    const listings = await scraper.searchViaHttp("corduroy jacket");

    expect(listings).toHaveLength(depopFixture.objects.length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchDepopViaScrapfly).toHaveBeenCalledTimes(1);
  });

  it("retries on a non-Cloudflare non-ok response and succeeds on the second attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, {}))
      .mockResolvedValueOnce(jsonResponse(200, depopFixture));

    const scraper = new DepopScraper(minimalConfig);
    const resultPromise = scraper.searchViaHttp("corduroy jacket");
    await vi.runAllTimersAsync();
    const listings = await resultPromise;

    expect(listings).toHaveLength(depopFixture.objects.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchDepopViaScrapfly).not.toHaveBeenCalled();
  });

  it("treats a Cloudflare-challenge response as one-shot escalation to ScrapFly, not a retry", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {}, { server: "cloudflare", "cf-ray": "abc123-ATL" }),
    );
    vi.mocked(fetchDepopViaScrapfly).mockResolvedValue(depopFixture);

    const config = {
      ...minimalConfig,
      platform_credentials: { scrapfly_api_key: "sf-key-123" },
    };
    const scraper = new DepopScraper(config);
    const listings = await scraper.searchViaHttp("corduroy jacket");

    expect(listings).toHaveLength(depopFixture.objects.length);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchDepopViaScrapfly).toHaveBeenCalledTimes(1);
    expect(fetchDepopViaScrapfly).toHaveBeenCalledWith(
      buildDepopProductsApiUrl("corduroy jacket"),
      "sf-key-123",
    );
  });

  it("does NOT escalate to ScrapFly on a non-Cloudflare 403 (no cf-ray/server:cloudflare headers)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, {}, {}));

    const scraper = new DepopScraper(minimalConfig);
    const assertion = expect(scraper.searchViaHttp("corduroy jacket")).rejects.toThrow(
      "Depop search HTTP 403",
    );
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchDepopViaScrapfly).not.toHaveBeenCalled();
  });

  it("propagates the ScrapFly-key-required error and does not retry the plain HTTP tier", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {}, { server: "cloudflare", "cf-ray": "abc123-ATL" }),
    );
    vi.mocked(fetchDepopViaScrapfly).mockRejectedValue(
      new Error("ScrapFly key required for Cloudflare bypass"),
    );

    // minimalConfig has no platform_credentials.scrapfly_api_key set.
    const scraper = new DepopScraper(minimalConfig);
    await expect(scraper.searchViaHttp("corduroy jacket")).rejects.toThrow(
      "ScrapFly key required for Cloudflare bypass",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a legitimate 2xx response with zero listings as an empty array, not retried or thrown", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { meta: {}, page_info: {}, objects: [] }));

    const scraper = new DepopScraper(minimalConfig);
    const listings = await scraper.searchViaHttp("corduroy jacket");

    expect(listings).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the last HTTP error message after exhausting all 3 attempts", async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, {}, {}));

    const scraper = new DepopScraper(minimalConfig);
    const assertion = expect(scraper.searchViaHttp("corduroy jacket")).rejects.toThrow(
      "Depop search HTTP 503",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits exactly 1500ms (attempt 0's backoff) before the second attempt, not immediately", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, {}))
      .mockResolvedValueOnce(jsonResponse(200, depopFixture));

    const scraper = new DepopScraper(minimalConfig);
    const resultPromise = scraper.searchViaHttp("corduroy jacket");

    // Let the first fetch + its rejection-check settle before the backoff
    // timer is scheduled.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Backoff for attempt 0 is 1500 + 0 * 1000 = 1500ms; the second fetch
    // must not fire before that elapses.
    await vi.advanceTimersByTimeAsync(1499);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const listings = await resultPromise;
    expect(listings).toHaveLength(depopFixture.objects.length);
  });

  it("lazily constructs the impit client once and reuses it across repeated calls", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, depopFixture));

    const scraper = new DepopScraper(minimalConfig);
    expect(impitConstructor).not.toHaveBeenCalled();

    await scraper.searchViaHttp("first query");
    await scraper.searchViaHttp("second query");

    expect(impitConstructor).toHaveBeenCalledTimes(1);
    expect(impitConstructor).toHaveBeenCalledWith({ browser: "firefox" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
