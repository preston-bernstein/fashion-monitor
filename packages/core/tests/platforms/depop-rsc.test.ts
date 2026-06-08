import { describe, expect, it } from "vitest";
import {
  extractDepopSearchFromHtml,
  buildDepopSearchUrl,
} from "../../src/platforms/depop/parse-rsc.js";
import { normalizeDepop, mapDepopProducts } from "../../src/platforms/depop/normalize.js";
import depopFixture from "../fixtures/depop/search-response.json";

describe("depop RSC parser", () => {
  it("builds search URL with male gender and sizes", () => {
    const url = buildDepopSearchUrl("corduroy jacket");
    expect(url).toContain("gender=male");
    expect(url).toContain("sort=newest");
    expect(url).toContain("q=corduroy");
  });

  it("extracts products from embedded Next.js flight payload", () => {
    const product = depopFixture.products[0];
    const html = `
      <script>
      self.__next_f.push([1,"\\"data\\":{\\"meta\\":{\\"result_count\\":1,\\"total_count\\":1},\\"products\\":[${JSON.stringify(product).replace(/"/g, '\\"')}]}}"]);
      </script>`;

    const payload = extractDepopSearchFromHtml(html);
    expect(payload?.products).toHaveLength(1);
    expect(normalizeDepop(payload!.products[0]).platform).toBe("depop");
  });

  it("maps product arrays via mapDepopProducts", () => {
    const listing = mapDepopProducts(depopFixture.products ?? [])[0];
    expect(listing.title).toContain("corduroy");
    expect(listing.price).toBe(45);
  });
});
