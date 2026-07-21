import type { Listing } from "../../core/types.js";
import { checkHealth, navigate } from "../stealth-sidecar/client.js";
import { pollContent, withEphemeralPage } from "../stealth-sidecar/session.js";
import { extractDepopTilesFromHtml, type DepopTileRaw } from "./extract.js";
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
  // FR12: fail fast if the sidecar is unreachable/unhealthy, before any
  // context/page gets created for this run.
  await checkHealth();

  return withEphemeralPage(async (pageId) => {
    const url = buildDepopSearchUrl(query);
    await navigate(pageId, url);

    // Approximates the old page.waitForTimeout retry loop's 4s/2s/2s cadence
    // (an initial longer wait for first render, then shorter re-checks) —
    // pollContent's fixed (timeoutMs, intervalMs) polling shape doesn't map
    // 1:1 onto "3 discrete attempts with a longer first wait", so this uses
    // the same total ~8s wait budget with a 2s poll interval, stopping as
    // soon as at least one tile is found. Never throws on timeout — like the
    // old loop, it just returns whatever HTML/tiles the last poll saw.
    const html = await pollContent(
      pageId,
      (content) => extractDepopTilesFromHtml(content, url).length > 0,
      { timeoutMs: 8_000, intervalMs: 2_000 },
    );

    const tiles: DepopTileRaw[] = extractDepopTilesFromHtml(html, url);
    return tiles.map(depopTileToListing).filter((listing): listing is Listing => listing !== null);
  });
}
