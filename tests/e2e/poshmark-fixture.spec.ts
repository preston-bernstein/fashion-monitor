import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { poshmarkTileExtractScript } from "../../packages/core/src/platforms/poshmark/extract.js";
import { parsePoshmarkTiles } from "../../packages/core/src/platforms/poshmark/normalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
  join(__dirname, "../../packages/core/tests/fixtures/poshmark/search-page.html"),
  "utf8",
);

test("extracts poshmark listing tiles from DOM fixture", async ({ page }) => {
  await page.setContent(fixtureHtml);

  const raw = await page.evaluate(poshmarkTileExtractScript);
  const listings = parsePoshmarkTiles(raw);

  expect(listings).toHaveLength(2);
  expect(listings[0]).toMatchObject({
    id: "pm-111",
    platform: "poshmark",
    title: "Dark Corduroy Shirt Jacket",
    brand: "John Varvatos Men's",
    price: 67,
    size: "XXL",
  });
});
