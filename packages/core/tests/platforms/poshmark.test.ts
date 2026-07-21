import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parsePoshmarkTiles } from "../../src/platforms/poshmark/normalize.js";
import { parsePoshmarkMetaText } from "../../src/platforms/poshmark/extract.js";
import { minimalConfig } from "../helpers/fixtures.js";
import type { SearchRequest } from "../../src/config/searches.js";

// getPoshmarkContext/scrapePoshmarkQuery/closePoshmarkContext/PoshmarkScraper now
// drive the stealth-sidecar over HTTP instead of a local Playwright/patchright
// BrowserContext — the retired driver's browser.ts mocking is gone; these mock
// the sidecar client (createPage/navigate/getContent/closePage) and session
// helpers (getOrCreatePersistentContext/closeAllPersistentContexts/pollContent)
// they call instead.
vi.mock("../../src/platforms/stealth-sidecar/client.js", () => ({
  createPage: vi.fn(),
  navigate: vi.fn(),
  getContent: vi.fn(),
  closePage: vi.fn(),
}));

vi.mock("../../src/platforms/stealth-sidecar/session.js", () => ({
  getOrCreatePersistentContext: vi.fn(),
  closeAllPersistentContexts: vi.fn(),
  pollContent: vi.fn(),
}));

import {
  createPage,
  navigate,
  getContent,
  closePage,
} from "../../src/platforms/stealth-sidecar/client.js";
import {
  getOrCreatePersistentContext,
  closeAllPersistentContexts,
  pollContent,
} from "../../src/platforms/stealth-sidecar/session.js";
import {
  getPoshmarkContext,
  scrapePoshmarkQuery,
  closePoshmarkContext,
  PoshmarkScraper,
} from "../../src/platforms/poshmark/scraper.js";

const TILE_HTML = `
  <a class="tile-grid-redesign__covershot" data-et-prop-listing_id="pm-111">
    <img src="/img/pm-111.jpg" />
  </a>
  <a class="tile-grid-redesign__meta-link" data-et-prop-listing_id="pm-111" href="/listing/pm-111">
    John Varvatos Men's Dark Corduroy Shirt Jacket $67 XXL
  </a>
`;

const EMPTY_HTML = "<div>no results</div>";

/** Same query-string construction as scrapePoshmarkQuery's internal URL build. */
function expectedSearchUrl(query: string): string {
  const params = new URLSearchParams({ query, department: "Men", sort_by: "added_desc" });
  params.append("size[]", "XL");
  params.append("size[]", "XXL");
  params.append("size[]", "2XL");
  return `https://poshmark.com/search?${params}`;
}

describe("poshmark normalize", () => {
  it("parses listing tiles", () => {
    const listings = parsePoshmarkTiles([
      {
        id: "pm-111",
        title: "Dark Corduroy Shirt Jacket",
        price: "$67",
        brand: "John Varvatos",
        size: "XXL",
        url: "https://poshmark.com/listing/pm-111",
        image: "https://example.com/img.jpg",
      },
    ]);
    expect(listings[0].price).toBe(67);
    expect(listings[0].platform).toBe("poshmark");
  });

  it("parses meta link text into title, price, brand, size", () => {
    const parsed = parsePoshmarkMetaText("John Varvatos Men's Dark Corduroy Shirt Jacket $67 XXL");
    expect(parsed).toEqual({
      brand: "John Varvatos Men's",
      title: "Dark Corduroy Shirt Jacket",
      price: "$67",
      size: "XXL",
    });
  });
});

describe("getPoshmarkContext", () => {
  beforeEach(() => {
    vi.mocked(getOrCreatePersistentContext).mockReset();
  });

  it("delegates to getOrCreatePersistentContext with the given profilePath and returns its contextId", async () => {
    vi.mocked(getOrCreatePersistentContext).mockResolvedValue("ctx-abc");

    const contextId = await getPoshmarkContext("data/poshmark-profile");

    expect(getOrCreatePersistentContext).toHaveBeenCalledWith("data/poshmark-profile");
    expect(contextId).toBe("ctx-abc");
  });
});

describe("closePoshmarkContext", () => {
  beforeEach(() => {
    vi.mocked(closeAllPersistentContexts).mockReset();
  });

  it("delegates to closeAllPersistentContexts", async () => {
    vi.mocked(closeAllPersistentContexts).mockResolvedValue(undefined);

    await closePoshmarkContext();

    expect(closeAllPersistentContexts).toHaveBeenCalledTimes(1);
  });
});

describe("scrapePoshmarkQuery", () => {
  beforeEach(() => {
    vi.mocked(createPage).mockReset().mockResolvedValue({ pageId: "page-1" });
    vi.mocked(navigate).mockReset().mockResolvedValue(undefined);
    vi.mocked(getContent).mockReset().mockResolvedValue(TILE_HTML);
    vi.mocked(closePage).mockReset().mockResolvedValue(undefined);
    vi.mocked(pollContent).mockReset().mockResolvedValue(TILE_HTML);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a page on the given context and navigates it to the built Men's search URL", async () => {
    const resultPromise = scrapePoshmarkQuery("ctx-abc", "corduroy jacket");
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(createPage).toHaveBeenCalledWith("ctx-abc");
    expect(navigate).toHaveBeenCalledWith("page-1", expectedSearchUrl("corduroy jacket"));
  });

  it("polls content on the created page with a predicate satisfied once tiles are found", async () => {
    const resultPromise = scrapePoshmarkQuery("ctx-abc", "corduroy jacket");
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(pollContent).toHaveBeenCalledTimes(1);
    const [pageIdArg, predicate, opts] = vi.mocked(pollContent).mock.calls[0];
    expect(pageIdArg).toBe("page-1");
    expect(opts).toEqual({ timeoutMs: 30_000, intervalMs: 2_000 });
    expect(predicate(TILE_HTML)).toBe(true);
    expect(predicate(EMPTY_HTML)).toBe(false);
  });

  it("converts the final getContent() HTML into Listings via extractPoshmarkTilesFromHtml + parsePoshmarkTiles", async () => {
    const resultPromise = scrapePoshmarkQuery("ctx-abc", "corduroy jacket");
    await vi.runAllTimersAsync();
    const listings = await resultPromise;

    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      id: "pm-111",
      platform: "poshmark",
      title: "Dark Corduroy Shirt Jacket",
      price: 67,
      brand: "John Varvatos Men's",
      size: "XXL",
      url: expect.stringContaining("/listing/pm-111"),
      imageUrl: expect.stringContaining("/img/pm-111.jpg"),
    });
  });

  it("returns an empty array (never throws) when the final content has no tiles", async () => {
    vi.mocked(getContent).mockResolvedValue(EMPTY_HTML);

    const resultPromise = scrapePoshmarkQuery("ctx-abc", "corduroy jacket");
    await vi.runAllTimersAsync();
    const listings = await resultPromise;

    expect(listings).toEqual([]);
  });

  it("always closes the page, even when the scrape throws partway through", async () => {
    vi.mocked(getContent).mockRejectedValue(new Error("sidecar content fetch failed"));

    const resultPromise = scrapePoshmarkQuery("ctx-abc", "corduroy jacket");
    // Attach the rejection assertion before advancing fake timers, so the
    // rejection (which fires mid-advance, after the sleep(2_000) timer) is
    // never briefly unhandled.
    const assertion = expect(resultPromise).rejects.toThrow("sidecar content fetch failed");
    await vi.runAllTimersAsync();
    await assertion;

    expect(closePage).toHaveBeenCalledWith("page-1");
  });
});

describe("PoshmarkScraper", () => {
  const queries: SearchRequest[] = [
    { queryId: "q1@poshmark", text: "corduroy jacket", sourceQueryId: "q1" },
  ];

  beforeEach(() => {
    vi.mocked(getOrCreatePersistentContext).mockReset();
    vi.mocked(createPage).mockReset().mockResolvedValue({ pageId: "page-1" });
    vi.mocked(navigate).mockReset().mockResolvedValue(undefined);
    vi.mocked(getContent).mockReset().mockResolvedValue(TILE_HTML);
    vi.mocked(closePage).mockReset().mockResolvedValue(undefined);
    vi.mocked(pollContent).mockReset().mockResolvedValue(TILE_HTML);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the persistent context using the configured poshmark_profile_path", async () => {
    vi.mocked(getOrCreatePersistentContext).mockResolvedValue("ctx-abc");

    const scraper = new PoshmarkScraper(minimalConfig);
    const resultPromise = scraper.search(queries);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(getOrCreatePersistentContext).toHaveBeenCalledWith(
      minimalConfig.scraper.poshmark_profile_path,
    );
  });

  it("returns ok: true with tagged listings when the query succeeds", async () => {
    vi.mocked(getOrCreatePersistentContext).mockResolvedValue("ctx-abc");

    const scraper = new PoshmarkScraper(minimalConfig);
    const resultPromise = scraper.search(queries);
    await vi.runAllTimersAsync();
    const outcome = await resultPromise;

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.listings).toHaveLength(1);
      expect(outcome.listings[0].platform).toBe("poshmark");
    }
  });

  // PoshmarkScraper.search() wraps BOTH getPoshmarkContext(...) and the
  // scrapeQueries(...) call in the same try/catch, so a context-open failure
  // (e.g. sidecar unreachable) degrades to `{ ok: false, error, queryResults: [] }`
  // like every other scrape failure, instead of rejecting out of search().
  // This isolation matters because orchestrator.scrapeAll() runs all platform
  // scrapers via Promise.all(...) — an uncaught rejection here would abort
  // scraping for every other platform in the same run.
  it("degrades to ok: false when opening the context fails, isolating the failure", async () => {
    vi.mocked(getOrCreatePersistentContext).mockRejectedValue(new Error("sidecar unreachable"));

    const scraper = new PoshmarkScraper(minimalConfig);

    await expect(scraper.search(queries)).resolves.toEqual({
      ok: false,
      error: "sidecar unreachable",
      queryResults: [],
    });
  });
});
