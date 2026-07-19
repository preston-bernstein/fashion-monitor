import { describe, expect, it } from "vitest";
import {
  extractDepopSearchFromHtml,
  buildDepopSearchUrl,
} from "../../src/platforms/depop/parse-rsc.js";
import { normalizeDepop, mapDepopProducts } from "../../src/platforms/depop/normalize.js";

// Legacy RSC-shaped product (no `pricing.final_price_key`) — this is what
// distinguishes it from the new API shape in normalizeDepop's dispatch, so it
// must be defined inline rather than reused from the shared JSON fixture
// (which is now entirely the new API shape).
function rscProduct(): Record<string, unknown> {
  return {
    id: 999,
    slug: "vintage-corduroy-jacket",
    description: "Vintage corduroy jacket",
    brand_name: "Universal Works",
    sizes: ["L"],
    pricing: {
      original_price: { price_breakdown: { price: { amount: "45.00" } } },
      currency_name: "USD",
    },
    preview: { "640": "https://depop.example/640.jpg" },
  };
}

describe("depop RSC parser", () => {
  it("builds search URL with male gender and sizes", () => {
    const url = buildDepopSearchUrl("corduroy jacket");
    expect(url).toContain("gender=male");
    expect(url).toContain("sort=newest");
    expect(url).toContain("q=corduroy");
  });

  it("extracts products from embedded Next.js flight payload", () => {
    const product = rscProduct();
    const html = `
      <script>
      self.__next_f.push([1,"\\"data\\":{\\"meta\\":{\\"result_count\\":1,\\"total_count\\":1},\\"products\\":[${JSON.stringify(product).replace(/"/g, '\\"')}]}}"]);
      </script>`;

    const payload = extractDepopSearchFromHtml(html);
    expect(payload?.products).toHaveLength(1);
    expect(normalizeDepop(payload!.products[0]).platform).toBe("depop");
  });

  it("maps product arrays via mapDepopProducts", () => {
    const listing = mapDepopProducts([rscProduct()])[0];
    expect(listing.title).toContain("corduroy");
    expect(listing.price).toBe(45);
  });
});
