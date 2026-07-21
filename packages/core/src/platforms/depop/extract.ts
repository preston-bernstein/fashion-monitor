import * as cheerio from "cheerio";

export interface DepopTileRaw {
  id: string;
  slug: string;
  title: string;
  price: string;
  brand: string | null;
  size: string;
  url: string;
  image: string | null;
}

/** Price-stripping helper shared by extractDepopTilesFromHtml's tile parsing. */
export function parseDepopTileText(text: string): { title: string; price: string } {
  const normalized = text.replace(/\s+/g, " ").trim();
  const priceMatch = normalized.match(/\$(\d+(?:\.\d{2})?)/);
  const price = priceMatch ? `$${priceMatch[1]}` : "";

  let title = normalized;
  if (priceMatch) {
    const before = normalized.slice(0, priceMatch.index).trim();
    const after = normalized.slice(priceMatch.index! + priceMatch[0].length).trim();
    title = [before, after].filter(Boolean).join(" ").trim();
  }

  return { title, price };
}

/**
 * Parses Depop search-results HTML (via cheerio) into tile data — replaces
 * the old page.evaluate()-based extraction now that the sidecar migration
 * means there's no live browser page to evaluate against.
 *
 * Selector confirmed live 2026-07-19: a[href*='/products/'] matched exactly
 * the page's item count on a 24-item search results page. Depop's granular
 * tile DOM (container boundaries, nested text node layout) was NOT fully
 * mapped in that check, so this walks a small fixed number of ancestor
 * levels to approximate a tile container rather than relying on an
 * unconfirmed exact structure.
 *
 * Unlike a live browser DOM's `.href`/`.src` getters, cheerio's `.attr('href')`
 * / `.attr('src')` return the RAW (possibly relative) attribute value, so both
 * `url` and `image` are explicitly resolved against baseUrl via `new URL()`
 * before being returned.
 */
export function extractDepopTilesFromHtml(html: string, baseUrl: string): DepopTileRaw[] {
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const results: DepopTileRaw[] = [];

  $("a[href*='/products/']").each((_, anchorEl) => {
    type El = typeof anchorEl;

    const isContainerBoundary = (el: El): boolean => {
      const tag = el.tagName?.toLowerCase() ?? "";
      if (tag === "li" || tag === "article") return true;
      const cls = $(el).attr("class") ?? "";
      return /card/i.test(cls);
    };

    // Walk up a small fixed number of ancestor levels (max 3) looking for a
    // reasonable container boundary (li / article / card-like div).
    const resolveContainer = (link: El): El => {
      let container = link;
      for (let i = 0; i < 3; i++) {
        if (isContainerBoundary(container)) break;
        const parent = $(container).parent().get(0);
        if (!parent) break;
        container = parent;
      }
      return container;
    };

    const resolveUrl = (value: string | undefined | null): string | null => {
      if (!value) return null;
      try {
        return new URL(value, baseUrl).toString();
      } catch {
        return null;
      }
    };

    const href = $(anchorEl).attr("href");
    if (!href) return;

    const match = href.match(/\/products\/([^/?#]+)/);
    const slug = match ? match[1] : null;
    if (!slug || seen.has(slug)) return;
    seen.add(slug);

    const container = resolveContainer(anchorEl);
    const rawText = $(container).text().replace(/\s+/g, " ").trim();
    const { title, price } = parseDepopTileText(rawText);
    const imageSrc = $(container).find("img").attr("src");

    results.push({
      id: slug,
      slug,
      title: title || rawText,
      price,
      brand: null,
      size: "",
      url: resolveUrl(href) ?? href,
      image: resolveUrl(imageSrc),
    });
  });

  return results;
}
