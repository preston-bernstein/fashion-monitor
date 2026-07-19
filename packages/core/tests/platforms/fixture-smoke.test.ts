import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeEbay } from "../../src/platforms/ebay/normalize.js";
import { normalizeGrailed } from "../../src/platforms/grailed/normalize.js";
import { mapDepopProducts } from "../../src/platforms/depop/normalize.js";
import { extractVestiaireProductsFromHtml } from "../../src/platforms/vestiaire/parse-html.js";
import { parsePoshmarkTiles } from "../../src/platforms/poshmark/normalize.js";
import ebayFixture from "../fixtures/ebay/search-response.json";
import grailedFixture from "../fixtures/grailed/algolia-response.json";
import depopFixture from "../fixtures/depop/search-response.json";

describe("platform fixture smoke", () => {
  it("all platform normalizers produce valid listings from fixtures", () => {
    const ebay = normalizeEbay(ebayFixture.itemSummaries[0] as Record<string, unknown>);
    expect(ebay.platform).toBe("ebay");

    const grailed = normalizeGrailed(grailedFixture.hits[0] as Record<string, unknown>);
    expect(grailed.platform).toBe("grailed");

    const depop = mapDepopProducts(depopFixture.objects ?? [])[0];
    expect(depop.platform).toBe("depop");

    const html = readFileSync(
      join(process.cwd(), "tests/fixtures/vestiaire/search-page.html"),
      "utf8",
    );
    const vestiaire = extractVestiaireProductsFromHtml(html);
    expect(vestiaire.length).toBeGreaterThan(0);

    const poshmark = parsePoshmarkTiles([
      {
        id: "1",
        title: "Test",
        price: "$10",
        brand: "Brand",
        size: "XL",
        url: "https://poshmark.com/x",
        image: null,
      },
    ]);
    expect(poshmark[0].platform).toBe("poshmark");
  });
});
