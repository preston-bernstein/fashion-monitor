import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractVestiaireProductsFromHtml } from "../../src/platforms/vestiaire/parse-html.js";
import { normalizeVestiaire } from "../../src/platforms/vestiaire/normalize.js";

describe("vestiaire", () => {
  it("extracts products from __NEXT_DATA__", () => {
    const html = readFileSync(
      join(process.cwd(), "tests/fixtures/vestiaire/search-page.html"),
      "utf8",
    );
    const products = extractVestiaireProductsFromHtml(html);
    expect(products).toHaveLength(1);
    const listing = normalizeVestiaire(products[0]);
    expect(listing.brand).toBe("Brunello Cucinelli");
    expect(listing.price).toBe(150);
  });
});
