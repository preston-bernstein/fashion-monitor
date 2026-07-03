import { describe, expect, it } from "vitest";
import { normalizeDepop } from "../../src/platforms/depop/normalize.js";

function rscProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "999",
    slug: "vintage-corduroy-jacket",
    brand_name: "Universal Works",
    sizes: ["L"],
    condition: "Used",
    date_created: "2026-01-01T00:00:00.000Z",
    pricing: {
      original_price: { price_breakdown: { price: { amount: "50.00" } } },
      currency_name: "USD",
    },
    preview: { "640": "https://depop.example/640.jpg", "1280": "https://depop.example/1280.jpg" },
    ...overrides,
  };
}

describe("normalizeDepop (RSC product shape)", () => {
  it("routes to the RSC branch whenever the item has a pricing field", () => {
    const listing = normalizeDepop(rscProduct());
    expect(listing.platform).toBe("depop");
    expect(listing.price).toBe(50);
    expect(listing.url).toBe("https://www.depop.com/products/vintage-corduroy-jacket/");
  });

  it("prefers discounted_price over original_price when both are present", () => {
    const listing = normalizeDepop(
      rscProduct({
        pricing: {
          original_price: { price_breakdown: { price: { amount: "50.00" } } },
          discounted_price: { price_breakdown: { price: { amount: "35.00" } } },
          currency_name: "USD",
        },
      }),
    );
    expect(listing.price).toBe(35);
  });

  it("falls back to '0' price when pricing has neither breakdown", () => {
    const listing = normalizeDepop(rscProduct({ pricing: {} }));
    expect(listing.price).toBe(0);
  });

  it("defaults currency to USD when pricing omits currency_name", () => {
    const listing = normalizeDepop(
      rscProduct({
        pricing: { original_price: { price_breakdown: { price: { amount: "10" } } } },
      }),
    );
    expect(listing.currency).toBe("USD");
  });

  it("prefers preview.640, then 1280, then 320, then pictures[0].formats.P0.url, then null", () => {
    expect(normalizeDepop(rscProduct()).imageUrl).toBe("https://depop.example/640.jpg");

    expect(
      normalizeDepop(rscProduct({ preview: { "1280": "https://depop.example/1280.jpg" } }))
        .imageUrl,
    ).toBe("https://depop.example/1280.jpg");

    expect(
      normalizeDepop(rscProduct({ preview: { "320": "https://depop.example/320.jpg" } })).imageUrl,
    ).toBe("https://depop.example/320.jpg");

    expect(
      normalizeDepop(
        rscProduct({
          preview: {},
          pictures: [{ formats: { P0: { url: "https://depop.example/pic.jpg" } } }],
        }),
      ).imageUrl,
    ).toBe("https://depop.example/pic.jpg");

    expect(normalizeDepop(rscProduct({ preview: {}, pictures: [] })).imageUrl).toBeNull();
  });

  it("derives a description from the slug (dashes replaced by spaces) when the item has none", () => {
    const listing = normalizeDepop(rscProduct({ description: undefined }));
    expect(listing.description).toBe("vintage corduroy jacket");
    expect(listing.title).toBe("vintage corduroy jacket");
  });

  it("uses the explicit description when present instead of the slug", () => {
    const listing = normalizeDepop(rscProduct({ description: "Rare vintage find" }));
    expect(listing.description).toBe("Rare vintage find");
  });

  it("maps brand_name, condition, sizes[0], and date_created", () => {
    const listing = normalizeDepop(rscProduct());
    expect(listing.brand).toBe("Universal Works");
    expect(listing.condition).toBe("Used");
    expect(listing.size).toBe("L");
    expect(listing.listedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves brand null and listedAt null when brand_name/date_created are absent", () => {
    const listing = normalizeDepop(rscProduct({ brand_name: undefined, date_created: undefined }));
    expect(listing.brand).toBeNull();
    expect(listing.listedAt).toBeNull();
  });
});
