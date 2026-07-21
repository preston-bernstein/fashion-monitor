import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  depopTileToListing,
  scrapeDepopViaPlaywright,
} from "../../src/platforms/depop/playwright-fallback.js";
import { buildDepopSearchUrl } from "../../src/platforms/depop/parse-rsc.js";
import type { DepopTileRaw } from "../../src/platforms/depop/extract.js";

// scrapeDepopViaPlaywright now drives the stealth-sidecar over HTTP instead of
// a local Playwright/patchright browser — the retired driver's `browser.ts` /
// playwright-extra/patchright mocking is gone; these mock the sidecar client
// (checkHealth/navigate) and session helpers (withEphemeralPage/pollContent)
// it calls instead.
vi.mock("../../src/platforms/stealth-sidecar/client.js", () => ({
  checkHealth: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("../../src/platforms/stealth-sidecar/session.js", () => ({
  withEphemeralPage: vi.fn(),
  pollContent: vi.fn(),
}));

import { checkHealth, navigate } from "../../src/platforms/stealth-sidecar/client.js";
import { pollContent, withEphemeralPage } from "../../src/platforms/stealth-sidecar/session.js";

const TILE_HTML = `
  <li>
    <a href="/products/vintage-band-tee/">
      <img src="/images/tee.jpg" />
      <span>Vintage Band Tee $13.00 Size M</span>
    </a>
  </li>
`;

const EMPTY_HTML = "<div>no results</div>";

/** Makes the mocked withEphemeralPage actually invoke its callback, like the real one. */
function setupWithEphemeralPage(pageId = "page-1") {
  vi.mocked(withEphemeralPage).mockImplementation(async (callback) => callback(pageId));
}

describe("scrapeDepopViaPlaywright", () => {
  beforeEach(() => {
    vi.mocked(checkHealth).mockReset().mockResolvedValue(undefined);
    vi.mocked(navigate).mockReset().mockResolvedValue(undefined);
    vi.mocked(withEphemeralPage).mockReset();
    vi.mocked(pollContent).mockReset();
  });

  it("checks sidecar health before opening an ephemeral page (FR12 fail-fast)", async () => {
    setupWithEphemeralPage();
    vi.mocked(pollContent).mockResolvedValue(TILE_HTML);

    await scrapeDepopViaPlaywright("vintage tee");

    expect(checkHealth).toHaveBeenCalledTimes(1);
    expect(withEphemeralPage).toHaveBeenCalledTimes(1);
  });

  it("propagates a checkHealth rejection without ever opening a page", async () => {
    vi.mocked(checkHealth).mockRejectedValue(new Error("sidecar unreachable"));

    await expect(scrapeDepopViaPlaywright("vintage tee")).rejects.toThrow("sidecar unreachable");
    expect(withEphemeralPage).not.toHaveBeenCalled();
  });

  it("navigates the ephemeral page to the built Depop search URL for the query", async () => {
    setupWithEphemeralPage("page-42");
    vi.mocked(pollContent).mockResolvedValue(TILE_HTML);

    await scrapeDepopViaPlaywright("vintage tee");

    const expectedUrl = buildDepopSearchUrl("vintage tee");
    expect(navigate).toHaveBeenCalledWith("page-42", expectedUrl);
  });

  it("polls content on the same page with the documented ~8s/2s wait budget", async () => {
    setupWithEphemeralPage("page-1");
    vi.mocked(pollContent).mockResolvedValue(TILE_HTML);

    await scrapeDepopViaPlaywright("vintage tee");

    expect(pollContent).toHaveBeenCalledTimes(1);
    const [pageIdArg, predicate, opts] = vi.mocked(pollContent).mock.calls[0];
    expect(pageIdArg).toBe("page-1");
    expect(opts).toEqual({ timeoutMs: 8_000, intervalMs: 2_000 });
    // predicate stops polling once extractDepopTilesFromHtml finds a tile.
    expect(predicate(TILE_HTML)).toBe(true);
    expect(predicate(EMPTY_HTML)).toBe(false);
  });

  it("converts the polled HTML into Listings via extractDepopTilesFromHtml + depopTileToListing", async () => {
    setupWithEphemeralPage();
    vi.mocked(pollContent).mockResolvedValue(TILE_HTML);

    const listings = await scrapeDepopViaPlaywright("vintage tee");

    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      id: "vintage-band-tee",
      platform: "depop",
      title: "Vintage Band Tee Size M",
      price: 13,
      currency: "USD",
      url: "https://www.depop.com/products/vintage-band-tee/",
      imageUrl: "https://www.depop.com/images/tee.jpg",
    });
  });

  it("returns an empty array (never throws) when the poll never turns up a tile", async () => {
    setupWithEphemeralPage();
    vi.mocked(pollContent).mockResolvedValue(EMPTY_HTML);

    const listings = await scrapeDepopViaPlaywright("vintage tee");

    expect(listings).toEqual([]);
  });

  it("filters out tiles whose price fails to parse, via depopTileToListing returning null", async () => {
    setupWithEphemeralPage();
    const html = `
      <li>
        <a href="/products/no-price-item/">
          <img src="/images/no-price.jpg" />
          <span>No Price Item</span>
        </a>
      </li>
    `;
    vi.mocked(pollContent).mockResolvedValue(html);

    const listings = await scrapeDepopViaPlaywright("vintage tee");

    expect(listings).toEqual([]);
  });
});

describe("depopTileToListing", () => {
  function tile(overrides: Partial<DepopTileRaw> = {}): DepopTileRaw {
    return {
      id: "vintage-band-tee",
      slug: "vintage-band-tee",
      title: "Vintage band tee",
      price: "$13.00",
      brand: null,
      size: "",
      url: "https://www.depop.com/products/vintage-band-tee/",
      image: "https://depop.example/tee.jpg",
      ...overrides,
    };
  }

  it("converts a tile with a valid price into a Listing", () => {
    const listing = depopTileToListing(tile());
    expect(listing).not.toBeNull();
    expect(listing).toMatchObject({
      id: "vintage-band-tee",
      platform: "depop",
      title: "Vintage band tee",
      description: "Vintage band tee",
      price: 13,
      currency: "USD",
      size: "",
      brand: null,
      url: "https://www.depop.com/products/vintage-band-tee/",
      imageUrl: "https://depop.example/tee.jpg",
      listedAt: null,
      condition: null,
    });
    expect((listing!.raw as Record<string, unknown>)._normalizerSource).toBe("dom-fallback");
  });

  it("returns null when the price is an empty string", () => {
    expect(depopTileToListing(tile({ price: "" }))).toBeNull();
  });

  it("returns null when the price text doesn't parse as a number", () => {
    expect(depopTileToListing(tile({ price: "not a price" }))).toBeNull();
  });

  it("passes through brand: null and size: '' unchanged (the honest-default DOM-fallback shape)", () => {
    const listing = depopTileToListing(tile({ brand: null, size: "" }));
    expect(listing?.brand).toBeNull();
    expect(listing?.size).toBe("");
  });

  it("maps id/title/url/imageUrl/brand/size from the tile fields precisely", () => {
    const listing = depopTileToListing(
      tile({
        id: "other-id",
        title: "Other title",
        url: "https://www.depop.com/products/other-id/",
        image: "https://depop.example/other.jpg",
        brand: "Nike",
        size: "M",
      }),
    );
    expect(listing).toMatchObject({
      id: "other-id",
      title: "Other title",
      description: "Other title",
      url: "https://www.depop.com/products/other-id/",
      imageUrl: "https://depop.example/other.jpg",
      brand: "Nike",
      size: "M",
    });
  });

  it("strips a leading '$' before parsing the price", () => {
    const listing = depopTileToListing(tile({ price: "$29.99" }));
    expect(listing?.price).toBe(29.99);
  });
});
