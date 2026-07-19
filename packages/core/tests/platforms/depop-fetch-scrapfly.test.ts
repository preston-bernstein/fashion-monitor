import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Vestiaire's own scrapfly-calling code (fetchViaScrapfly in
// platforms/vestiaire/fetch-page.ts) is never exercised directly in this
// repo's tests either — vestiaire-scraper.test.ts mocks fetchVestiaireHtml at
// a higher level and never touches scrapfly-sdk. So this is the first direct
// test of the real ScrapFly-SDK-calling code path in this repo; the mock
// below is written from scratch rather than copied from an existing pattern.
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

const scrapeMock = vi.fn();
const ScrapflyClientMock = vi.fn(function ScrapflyClient(this: { scrape: typeof scrapeMock }) {
  this.scrape = scrapeMock;
});
const ScrapeConfigMock = vi.fn(function ScrapeConfig(this: unknown, opts: unknown) {
  return opts;
});

vi.mock("scrapfly-sdk", () => ({
  ScrapflyClient: ScrapflyClientMock,
  ScrapeConfig: ScrapeConfigMock,
}));

import { fetchDepopViaScrapfly } from "../../src/platforms/depop/fetch-scrapfly.js";
import { LogEvents } from "../../src/lib/log-events.js";

const ORIGINAL_ENV_KEY = process.env.SCRAPFLY_API_KEY;

describe("fetchDepopViaScrapfly", () => {
  beforeEach(() => {
    scrapeMock.mockReset();
    ScrapflyClientMock.mockClear();
    ScrapeConfigMock.mockClear();
    logSpy.info.mockClear();
    logSpy.warn.mockClear();
    delete process.env.SCRAPFLY_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_ENV_KEY === undefined) {
      delete process.env.SCRAPFLY_API_KEY;
    } else {
      process.env.SCRAPFLY_API_KEY = ORIGINAL_ENV_KEY;
    }
  });

  it("throws 'ScrapFly key required for Cloudflare bypass' when no key is available, and never touches the SDK", async () => {
    await expect(fetchDepopViaScrapfly("https://depop.example/api")).rejects.toThrow(
      "ScrapFly key required for Cloudflare bypass",
    );
    expect(ScrapflyClientMock).not.toHaveBeenCalled();
    expect(scrapeMock).not.toHaveBeenCalled();
  });

  it("calls the ScrapFly SDK and returns the JSON-parsed content when a key is provided", async () => {
    scrapeMock.mockResolvedValue({ content: JSON.stringify({ meta: {}, objects: [] }) });

    const result = await fetchDepopViaScrapfly("https://depop.example/api", "explicit-key");

    expect(result).toEqual({ meta: {}, objects: [] });
    expect(ScrapflyClientMock).toHaveBeenCalledWith({ key: "explicit-key" });
    expect(scrapeMock).toHaveBeenCalledTimes(1);
    // asp:true engages ScrapFly's anti-scraping-protection bypass (the whole
    // point of this tier); render_js:false keeps it a plain HTTP fetch on
    // ScrapFly's side, not a full headless-browser render (cheaper, and this
    // endpoint returns JSON directly with no client-side rendering to wait on).
    expect(ScrapeConfigMock).toHaveBeenCalledWith({
      url: "https://depop.example/api",
      asp: true,
      render_js: false,
    });
    expect(logSpy.info).toHaveBeenCalledWith(LogEvents.PlatformDepopScrapflySuccess, {
      url: "https://depop.example/api",
    });
  });

  it("prefers the explicit apiKey param over process.env.SCRAPFLY_API_KEY", async () => {
    process.env.SCRAPFLY_API_KEY = "env-key";
    scrapeMock.mockResolvedValue({ content: JSON.stringify({}) });

    await fetchDepopViaScrapfly("https://depop.example/api", "param-key");

    expect(ScrapflyClientMock).toHaveBeenCalledWith({ key: "param-key" });
  });

  it("falls back to process.env.SCRAPFLY_API_KEY when no apiKey param is passed", async () => {
    process.env.SCRAPFLY_API_KEY = "env-key";
    scrapeMock.mockResolvedValue({ content: JSON.stringify({}) });

    await fetchDepopViaScrapfly("https://depop.example/api");

    expect(ScrapflyClientMock).toHaveBeenCalledWith({ key: "env-key" });
  });

  // The catch block logs only the error's *type* (error.name), never its raw
  // .message — a ScrapFly SDK error can embed the underlying HTTP
  // request/response content, which may echo the API key or a harvested
  // Cloudflare cookie verbatim. The rethrown error also preserves the
  // original as `cause`, matching scraper.ts's searchQuery catch pattern, so
  // a debugger can still see the real failure without it leaking into logs.
  it("wraps an SDK failure without leaking its raw message, and preserves it as cause", async () => {
    const sdkError = new Error("upstream 500 from provider — includes sf_key=abc123 in the url");
    scrapeMock.mockRejectedValue(sdkError);

    const caught = await fetchDepopViaScrapfly("https://depop.example/api", "explicit-key").catch(
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("Depop ScrapFly fetch failed: Error");
    expect((caught as Error).message).not.toContain("sf_key=abc123");
    expect((caught as Error).cause).toBe(sdkError);

    expect(logSpy.warn).toHaveBeenCalledWith(LogEvents.PlatformDepopScrapflyFailed, {
      url: "https://depop.example/api",
      reason: "Error",
    });
    const warnCallArgs = logSpy.warn.mock.calls[0];
    expect(JSON.stringify(warnCallArgs)).not.toContain("sf_key=abc123");
  });

  it("wraps a non-Error rejection as 'UnknownError' in both the log and the thrown message", async () => {
    scrapeMock.mockRejectedValue("a plain string rejection");

    await expect(
      fetchDepopViaScrapfly("https://depop.example/api", "explicit-key"),
    ).rejects.toThrow("Depop ScrapFly fetch failed: UnknownError");

    expect(logSpy.warn).toHaveBeenCalledWith(LogEvents.PlatformDepopScrapflyFailed, {
      url: "https://depop.example/api",
      reason: "UnknownError",
    });
  });
});
