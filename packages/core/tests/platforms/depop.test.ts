import { describe, expect, it } from "vitest";
import depopFixture from "../fixtures/depop/search-response.json";
import { parseDepopProducts } from "../../src/platforms/depop/scraper.js";

describe("depop normalize", () => {
  it("parses search response", () => {
    const listings = parseDepopProducts(depopFixture);
    expect(listings[0].platform).toBe("depop");
    expect(listings[0].brand).toBe("Universal Works");
    expect(listings[0].price).toBe(45);
  });
});
