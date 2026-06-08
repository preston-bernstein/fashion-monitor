import { describe, expect, it } from "vitest";
import { normalizeEbay } from "../../src/platforms/ebay/normalize.js";
import ebayFixture from "../fixtures/ebay/search-response.json";

describe("ebay normalize", () => {
  it("normalizes search response items", () => {
    const item = ebayFixture.itemSummaries[0] as Record<string, unknown>;
    const listing = normalizeEbay(item);
    expect(listing.platform).toBe("ebay");
    expect(listing.brand).toBe("Helmut Lang");
    expect(listing.size).toBe("XXL");
    expect(listing.price).toBe(75);
  });

  it("handles missing optional fields", () => {
    const item = ebayFixture.itemSummaries[1] as Record<string, unknown>;
    const listing = normalizeEbay(item);
    expect(listing.description).toBe("");
    expect(listing.size).toBe("");
  });
});
