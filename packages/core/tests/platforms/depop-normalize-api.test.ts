import { describe, expect, it } from "vitest";
import { normalizeDepop, mapDepopProducts } from "../../src/platforms/depop/normalize.js";

function apiProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "789",
    slug: "vintage-band-tee",
    description: "Vintage band tee",
    brand_name: "Nike",
    sizes: [{ name: "M" }],
    attributes: { condition: "Used" },
    pricing: {
      final_price_key: "current_price",
      currency: "USD",
      current_price: { price_breakdown: { price: { amount: "25.00" } } },
      original_price: { price_breakdown: { price: { amount: "30.00" } } },
    },
    preview: { formats: { P0: { url: "https://depop.example/api-preview.jpg" } } },
    pictures: [{ formats: { P0: { url: "https://depop.example/api-pic.jpg" } } }],
    ...overrides,
  };
}

describe("normalizeDepop (new API product shape)", () => {
  it("routes an item with pricing.final_price_key to the API branch, not the RSC branch", () => {
    // A new-API-shaped item also has a `pricing` key, which is exactly what
    // the older RSC-branch check alone would have matched — final_price_key
    // must be what disambiguates the two.
    const listing = normalizeDepop(apiProduct());
    expect((listing.raw as Record<string, unknown>)._normalizerSource).toBe("api");
  });

  it("throws 'Depop product missing id' when id is null", () => {
    expect(() => normalizeDepop(apiProduct({ id: null }))).toThrow("Depop product missing id");
  });

  it("throws 'Depop product missing id' when id is undefined", () => {
    expect(() => normalizeDepop(apiProduct({ id: undefined }))).toThrow(
      "Depop product missing id",
    );
  });

  it("throws 'Depop product missing parseable price' when price_breakdown.price.amount is absent", () => {
    expect(() =>
      normalizeDepop(
        apiProduct({
          pricing: { final_price_key: "original_price", original_price: {} },
        }),
      ),
    ).toThrow("Depop product missing parseable price");
  });

  it("throws 'Depop product missing parseable price' when the amount is present but unparseable", () => {
    expect(() =>
      normalizeDepop(
        apiProduct({
          pricing: {
            final_price_key: "original_price",
            original_price: { price_breakdown: { price: { amount: "not-a-number" } } },
          },
        }),
      ),
    ).toThrow("Depop product missing parseable price");
  });

  it("resolves the price via pricing.current_price when final_price_key is 'current_price'", () => {
    const listing = normalizeDepop(
      apiProduct({
        pricing: {
          final_price_key: "current_price",
          current_price: { price_breakdown: { price: { amount: "25.00" } } },
          original_price: { price_breakdown: { price: { amount: "30.00" } } },
        },
      }),
    );
    expect(listing.price).toBe(25);
  });

  it("resolves the price via pricing.original_price when final_price_key is 'original_price'", () => {
    const listing = normalizeDepop(
      apiProduct({
        pricing: {
          final_price_key: "original_price",
          current_price: { price_breakdown: { price: { amount: "25.00" } } },
          original_price: { price_breakdown: { price: { amount: "30.00" } } },
        },
      }),
    );
    expect(listing.price).toBe(30);
  });

  // NOTE ON REACHABILITY: resolveDepopApiPrice defaults finalPriceKey to
  // "original_price" via `pricing?.final_price_key ?? "original_price"", but
  // normalizeDepop's own dispatch (`if (pricing?.final_price_key) { return
  // normalizeDepopApiProduct(item); }`) only ever calls into this branch when
  // final_price_key is already truthy — so that internal default cannot
  // actually be exercised through the public normalizeDepop/normalizeDepop-
  // ApiProduct surface as written; it's effectively dead code today. This test
  // documents the equivalent observable behavior (an explicit "original_price"
  // key resolves the original_price entry) rather than a true default-path
  // exercise, since no public call can omit final_price_key and still land in
  // this branch. Flagged in the task report as a real finding, not a bug fix.
  it("resolves pricing.original_price when final_price_key is explicitly 'original_price' (documents the same value the internal default would produce)", () => {
    const listing = normalizeDepop(
      apiProduct({
        pricing: {
          final_price_key: "original_price",
          original_price: { price_breakdown: { price: { amount: "42.00" } } },
        },
      }),
    );
    expect(listing.price).toBe(42);
  });

  it("defaults currency to USD when pricing.currency is absent", () => {
    const listing = normalizeDepop(
      apiProduct({
        pricing: {
          final_price_key: "original_price",
          original_price: { price_breakdown: { price: { amount: "10.00" } } },
        },
      }),
    );
    expect(listing.currency).toBe("USD");
  });

  it("uses the explicit currency when pricing.currency is present", () => {
    const listing = normalizeDepop(apiProduct({ pricing: { ...apiProduct().pricing, currency: "GBP" } }));
    expect(listing.currency).toBe("GBP");
  });

  it("prefers preview.formats.P0.url for the image when present", () => {
    const listing = normalizeDepop(apiProduct());
    expect(listing.imageUrl).toBe("https://depop.example/api-preview.jpg");
  });

  it("falls back to pictures[0].formats.P0.url when preview is absent", () => {
    const listing = normalizeDepop(apiProduct({ preview: undefined }));
    expect(listing.imageUrl).toBe("https://depop.example/api-pic.jpg");
  });

  it("resolves imageUrl to null when both preview and pictures are absent", () => {
    const listing = normalizeDepop(apiProduct({ preview: undefined, pictures: [] }));
    expect(listing.imageUrl).toBeNull();
  });

  it("uses sizes[0].name when sizes is present", () => {
    const listing = normalizeDepop(apiProduct({ sizes: [{ name: "L" }] }));
    expect(listing.size).toBe("L");
  });

  it("defaults size to '' when sizes is absent", () => {
    const listing = normalizeDepop(apiProduct({ sizes: undefined }));
    expect(listing.size).toBe("");
  });

  it("defaults size to '' when sizes is an empty array", () => {
    const listing = normalizeDepop(apiProduct({ sizes: [] }));
    expect(listing.size).toBe("");
  });

  it("uses brand_name when present", () => {
    const listing = normalizeDepop(apiProduct({ brand_name: "Adidas" }));
    expect(listing.brand).toBe("Adidas");
  });

  it("resolves brand to null when brand_name is absent", () => {
    const listing = normalizeDepop(apiProduct({ brand_name: undefined }));
    expect(listing.brand).toBeNull();
  });

  it("uses attributes.condition when present", () => {
    const listing = normalizeDepop(apiProduct({ attributes: { condition: "New with tags" } }));
    expect(listing.condition).toBe("New with tags");
  });

  it("resolves condition to null when attributes is absent", () => {
    const listing = normalizeDepop(apiProduct({ attributes: undefined }));
    expect(listing.condition).toBeNull();
  });

  it("resolves condition to null when attributes is present but has no condition", () => {
    const listing = normalizeDepop(apiProduct({ attributes: {} }));
    expect(listing.condition).toBeNull();
  });

  it("uses slug for the url when present", () => {
    const listing = normalizeDepop(apiProduct({ slug: "cool-vintage-jacket" }));
    expect(listing.url).toBe("https://www.depop.com/products/cool-vintage-jacket/");
  });

  it("falls back to String(id) for the url when slug is absent", () => {
    const listing = normalizeDepop(apiProduct({ slug: undefined, id: "456" }));
    expect(listing.url).toBe("https://www.depop.com/products/456/");
  });

  it("uses the explicit description for title/description when present", () => {
    const listing = normalizeDepop(apiProduct({ description: "Rare vintage find" }));
    expect(listing.title).toBe("Rare vintage find");
    expect(listing.description).toBe("Rare vintage find");
  });

  it("derives title/description from the slug (hyphens replaced by spaces) when description is absent", () => {
    const listing = normalizeDepop(
      apiProduct({ description: undefined, slug: "vintage-band-tee" }),
    );
    expect(listing.title).toBe("vintage band tee");
    expect(listing.description).toBe("vintage band tee");
  });

  it("always resolves listedAt to null (no timestamp field on this shape)", () => {
    const listing = normalizeDepop(apiProduct());
    expect(listing.listedAt).toBeNull();
  });

  it("tags raw._normalizerSource as exactly 'api'", () => {
    const listing = normalizeDepop(apiProduct());
    expect((listing.raw as Record<string, unknown>)._normalizerSource).toBe("api");
  });
});

describe("mapDepopProducts — batch resilience", () => {
  it("skips a single malformed product (missing id) rather than failing the entire batch", () => {
    const good1 = apiProduct({ id: "1", slug: "item-one" });
    const bad = apiProduct({ id: null, slug: "item-bad" });
    const good2 = apiProduct({ id: "3", slug: "item-three" });

    const listings = mapDepopProducts([good1, bad, good2]);

    // One bad item among three must not sink the two good ones — a real
    // 24-item search-results page with a single malformed entry should not
    // come back empty and trigger a needless fallback escalation.
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.id)).toEqual(["1", "3"]);
  });

  it("returns an empty array (not a throw) when every product in the batch is malformed", () => {
    const listings = mapDepopProducts([
      apiProduct({ id: null }),
      apiProduct({ id: undefined }),
    ]);
    expect(listings).toEqual([]);
  });
});
