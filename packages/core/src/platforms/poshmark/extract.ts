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
 * Runs in the browser via page.evaluate — must stay self-contained (no imports).
 * Keep meta parsing aligned with parsePoshmarkMetaText().
 */
export function poshmarkTileExtractScript(): PoshmarkTileRaw[] {
  const seen = new Set<string>();
  const results: PoshmarkTileRaw[] = [];

  for (const meta of Array.from(
    document.querySelectorAll("a.tile-grid-redesign__meta-link[data-et-prop-listing_id]"),
  )) {
    const link = meta as HTMLAnchorElement;
    const id = link.dataset.etPropListing_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const imageLink = document.querySelector(
      `a.tile-grid-redesign__covershot[data-et-prop-listing_id="${id}"] img, a.tile__covershot[data-et-prop-listing_id="${id}"] img`,
    ) as HTMLImageElement | null;

    const text = link.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const priceMatch = text.match(/\$(\d+(?:\.\d{2})?)/);
    const price = priceMatch ? `$${priceMatch[1]}` : "";
    let title = text;
    let size = "";
    let brand: string | null = null;

    if (priceMatch) {
      title = text.slice(0, priceMatch.index).trim();
      const afterPrice = text.slice(priceMatch.index! + priceMatch[0].length).trim();
      size = afterPrice.split(" ").pop() ?? "";
    }

    const brandMatch = title.match(/^(.+?\sMen[''']?s)\s+(.+)$/i);
    if (brandMatch) {
      brand = brandMatch[1].trim();
      title = brandMatch[2].trim();
    }

    results.push({
      id,
      title: title || text,
      price,
      brand,
      size,
      url: link.href,
      image: imageLink?.src ?? null,
    });
  }

  return results;
}
