import { describe, expect, it, vi, beforeEach } from "vitest";
import depopFixture from "../fixtures/depop/search-response.json";
import { minimalConfig } from "../helpers/fixtures.js";
import type { Listing } from "../../src/core/types.js";
import { LogEvents } from "../../src/lib/log-events.js";

const fetchMock = vi.fn();

vi.mock("impit", () => ({
  Impit: class MockImpit {
    fetch = fetchMock;
  },
}));

// Spy on the logger the same way scorer-vision.test.ts does, so searchQuery's
// catch-block log.warn call (event + full context object) can be asserted
// precisely, not just its side effects.
const logSpy = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../src/lib/logging.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/logging.js")>();
  return { ...actual, createLogger: () => ({ ...logSpy, child: () => logSpy }) };
});

vi.mock("../../src/platforms/depop/playwright-fallback.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/platforms/depop/playwright-fallback.js")>();
  return { ...actual, scrapeDepopViaPlaywright: vi.fn() };
});

const { DepopScraper, parseDepopProducts } = await import("../../src/platforms/depop/scraper.js");
const { scrapeDepopViaPlaywright } = await import(
  "../../src/platforms/depop/playwright-fallback.js"
);

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

function cloudflareResponse() {
  return {
    ok: false,
    status: 403,
    headers: {
      get: (name: string) =>
        ({ server: "cloudflare", "cf-ray": "abc123-ATL" })[name.toLowerCase()] ?? null,
    },
    json: async () => ({}),
  };
}

function plainErrorResponse(status: number) {
  return { ok: false, status, headers: { get: () => null }, json: async () => ({}) };
}

describe("depop normalize", () => {
  it("parses search response", () => {
    const listings = parseDepopProducts(depopFixture);
    expect(listings[0].platform).toBe("depop");
    expect(listings[0].brand).toBe("Fashion Nova");
    expect(listings[0].price).toBe(13);
  });

  it("uses the discounted current_price, not original_price, when is_reduced is true", () => {
    const listings = parseDepopProducts(depopFixture);
    expect(listings[1].brand).toBe("Urban Outfitters");
    expect(listings[1].price).toBe(29.99);
  });
});

describe("DepopScraper.searchQuery — cascade exhaustion", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(scrapeDepopViaPlaywright).mockReset();
    logSpy.info.mockClear();
    logSpy.warn.mockClear();
    vi.useFakeTimers();
  });

  it("falls through to the Playwright fallback when Cloudflare blocks and no ScrapFly key is configured", async () => {
    // minimalConfig has no platform_credentials.scrapfly_api_key set, so the
    // real fetchDepopViaScrapfly throws "ScrapFly key required for Cloudflare
    // bypass" internally (not mocked here — this exercises the real function),
    // and searchQuery must fall through to the Playwright fallback rather than
    // surfacing that error directly to the caller.
    fetchMock.mockResolvedValue(cloudflareResponse());
    vi.mocked(scrapeDepopViaPlaywright).mockResolvedValue([sampleListing()]);

    const scraper = new DepopScraper(minimalConfig);
    const listings = await scraper.searchQuery("corduroy jacket");

    expect(listings).toHaveLength(1);
    expect(scrapeDepopViaPlaywright).toHaveBeenCalledWith("corduroy jacket");
    // The catch block's log.warn must carry both the original failure message
    // AND the literal fallback: "playwright" tag, not just be called at all.
    expect(logSpy.warn).toHaveBeenCalledWith(LogEvents.PlatformDepopHttpFailed, {
      error: "ScrapFly key required for Cloudflare bypass",
      fallback: "playwright",
    });
  });

  it("throws — never returns a silent empty array — when every tier is exhausted", async () => {
    fetchMock.mockResolvedValue(plainErrorResponse(503));
    vi.mocked(scrapeDepopViaPlaywright).mockResolvedValue([]);

    const scraper = new DepopScraper(minimalConfig);
    const resultPromise = scraper.searchQuery("corduroy jacket");
    const assertion = expect(resultPromise).rejects.toThrow(
      "Depop Playwright fallback returned no listings",
    );
    await vi.runAllTimersAsync();
    await assertion;

    // The thrown error must preserve the original HTTP failure as `cause` —
    // this is what lets a debugger see *why* the HTTP tier failed in the
    // first place, not just that the fallback also came up empty.
    const caught = await resultPromise.catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).cause).toBeInstanceOf(Error);
    expect(((caught as Error).cause as Error).message).toBe("Depop search HTTP 503");
  });
});
