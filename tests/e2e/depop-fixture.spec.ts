import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { depopTileExtractScript } from "../../packages/core/src/platforms/depop/extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
  join(__dirname, "../../packages/core/tests/fixtures/depop/search-page.html"),
  "utf8",
);

test("extracts depop product tiles from DOM fixture via the confirmed a[href*='/products/'] selector", async ({
  page,
}) => {
  await page.setContent(fixtureHtml);

  const tiles = await page.evaluate(depopTileExtractScript);

  // The fixture has a third, duplicate anchor pointing at the same product
  // slug (simulating an overlapping "like" link) — depopTileExtractScript
  // must dedupe by slug and return exactly 2 tiles, not 3.
  expect(tiles).toHaveLength(2);

  expect(tiles[0]).toMatchObject({
    id: "buono-fashion-nova-can-it-be-a567",
    slug: "buono-fashion-nova-can-it-be-a567",
    price: "$13.00",
    url: "https://www.depop.com/products/buono-fashion-nova-can-it-be-a567/",
    image: "https://media-photos.depop.com/r1/423899990/4199061637_8931d4ea15cc40208342601aa7356fa7/P0.jpg",
    brand: null,
    size: "",
  });
  expect(tiles[0].title).toContain("Fashion Nova");
  expect(tiles[0].title).toContain("Can It Be Corduroy Jacket");

  expect(tiles[1]).toMatchObject({
    id: "urban-outfitters-vintage-band-tee-b234",
    slug: "urban-outfitters-vintage-band-tee-b234",
    price: "$29.99",
  });
});
