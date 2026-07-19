import { describe, expect, it } from "vitest";
import { depopTileToListing } from "../../src/platforms/depop/playwright-fallback.js";
import type { DepopTileRaw } from "../../src/platforms/depop/extract.js";

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

describe("depopTileToListing", () => {
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
