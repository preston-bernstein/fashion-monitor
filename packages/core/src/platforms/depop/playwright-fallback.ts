import type { Listing } from "../../core/types.js";
import { launchStealthEphemeralBrowser } from "../playwright/browser.js";
import { depopTileExtractScript, type DepopTileRaw } from "./extract.js";
import { buildDepopSearchUrl } from "./parse-rsc.js";

export function depopTileToListing(tile: DepopTileRaw): Listing | null {
  const price = parseFloat(tile.price.replace(/^\$/, ""));
  if (Number.isNaN(price)) return null;

  return {
    id: tile.id,
    platform: "depop",
    title: tile.title,
    description: tile.title,
    price,
    currency: "USD",
    size: tile.size,
    brand: tile.brand,
    url: tile.url,
    imageUrl: tile.image,
    listedAt: null,
    condition: null,
    raw: { ...tile, _normalizerSource: "dom-fallback" },
  };
}

export async function scrapeDepopViaPlaywright(query: string): Promise<Listing[]> {
  const browser = await launchStealthEphemeralBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(buildDepopSearchUrl(query), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const consent = page
      .locator('#onetrust-accept-btn-handler, button:has-text("Accept all")')
      .first();
    if (await consent.count()) {
      await consent.click({ timeout: 5_000 }).catch(() => undefined);
    }

    let tiles: DepopTileRaw[] = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(i === 0 ? 4_000 : 2_000);
      tiles = await page.evaluate(depopTileExtractScript);
      if (tiles.length > 0) break;
    }

    return tiles.map(depopTileToListing).filter((listing): listing is Listing => listing !== null);
  } finally {
    await page.close();
  }
}
