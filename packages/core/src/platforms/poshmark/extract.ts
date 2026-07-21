import * as cheerio from "cheerio";

export interface PoshmarkTileRaw {
  id: string;
  title: string;
  price: string;
  brand: string | null;
  size: string;
  url: string;
  image: string | null;
}

export function parsePoshmarkMetaText(text: string): {
  title: string;
  price: string;
  size: string;
  brand: string | null;
} {
  const normalized = text.replace(/\s+/g, " ").trim();
  const priceMatch = normalized.match(/\$(\d+(?:\.\d{2})?)/);
  const price = priceMatch ? `$${priceMatch[1]}` : "";

  const beforePrice = priceMatch ? normalized.slice(0, priceMatch.index).trim() : normalized;
  let size = "";
  if (priceMatch) {
    const afterPrice = normalized.slice(priceMatch.index! + priceMatch[0].length).trim();
    size = afterPrice.split(" ").pop() ?? "";
  }

  let brand: string | null = null;
  let title = beforePrice;
  const brandSplit = beforePrice.match(/^(.+?\sMen[''']?s)\s+(.+)$/i);
  if (brandSplit) {
    brand = brandSplit[1].trim();
    title = brandSplit[2].trim();
  }

  return { title, price, size, brand };
}

/**
 * Parses Poshmark search-results HTML (via cheerio) into tile data — replaces
 * the old page.evaluate()-based extraction now that the sidecar migration
 * means there's no live browser page to evaluate against. href/src attributes
 * are raw (possibly relative) in the static markup, unlike a live browser DOM
 * which auto-resolves them, so url/image are explicitly resolved against
 * baseUrl.
 */
export function extractPoshmarkTilesFromHtml(html: string, baseUrl: string): PoshmarkTileRaw[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: PoshmarkTileRaw[] = [];

  $("a.tile-grid-redesign__meta-link[data-et-prop-listing_id]").each((_, el) => {
    const link = $(el);
    const id = link.attr("data-et-prop-listing_id");
    if (!id || seen.has(id)) return;
    seen.add(id);

    const imageEl = $(
      `a.tile-grid-redesign__covershot[data-et-prop-listing_id="${id}"] img, a.tile__covershot[data-et-prop-listing_id="${id}"] img`,
    ).first();

    const text = link.text().replace(/\s+/g, " ").trim();
    const { title, price, size, brand } = parsePoshmarkMetaText(text);

    const href = link.attr("href");
    if (!href) return;
    const url = new URL(href, baseUrl).toString();

    const src = imageEl.attr("src");
    const image = src ? new URL(src, baseUrl).toString() : null;

    results.push({
      id,
      title: title || text,
      price,
      brand,
      size,
      url,
      image,
    });
  });

  return results;
}
