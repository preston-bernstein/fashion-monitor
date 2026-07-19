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

/**
 * Node-callable helper mirroring the browser-side price-stripping logic, so the
 * same parsing behavior can be exercised/tested outside a page.evaluate context.
 * Mirrors parsePoshmarkMetaText()'s role relative to poshmarkTileExtractScript().
 */
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
 * Runs in the browser via page.evaluate — must stay self-contained (no imports
 * AND no calls to other module-scope functions, including parseDepopTileText
 * above: page.evaluate only serializes this function's own source, so a
 * reference to a sibling function is a dangling ReferenceError in the page's
 * isolated realm, not a closure — confirmed live via a real Playwright run.
 * The price/title-stripping logic below is intentionally duplicated inline;
 * keep it aligned with parseDepopTileText() by hand, same convention as
 * Poshmark's poshmarkTileExtractScript()/parsePoshmarkMetaText() split.
 *
 * Selector confirmed live 2026-07-19: a[href*='/products/'] matched exactly the
 * page's item count on a 24-item search results page. Depop's granular tile DOM
 * (container boundaries, nested text node layout) was NOT fully mapped in that
 * check, so this walks a small fixed number of ancestor levels to approximate a
 * tile container rather than relying on an unconfirmed exact structure.
 */
export function depopTileExtractScript(): DepopTileRaw[] {
  // Nested functions (not module-level siblings) are fine here — they're part
  // of this function's own serialized source, unlike a call to a function
  // declared elsewhere in this file (see the block comment above).
  const isContainerBoundary = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag === "li" || tag === "article") return true;
    const cls = el.getAttribute("class") ?? "";
    return /card/i.test(cls);
  };

  // Walk up a small fixed number of ancestor levels (max 3) looking for a
  // reasonable container boundary (li / article / card-like div). This is a
  // best-effort approximation since the exact tile DOM wasn't fully mapped.
  const resolveContainer = (link: Element): Element => {
    let container = link;
    for (let i = 0; i < 3; i++) {
      if (isContainerBoundary(container)) break;
      const parent = container.parentElement;
      if (!parent) break;
      container = parent;
    }
    return container;
  };

  // Inlined copy of parseDepopTileText's logic — see the function-level
  // comment above for why this can't just call that function.
  const stripPrice = (rawText: string): { title: string; price: string } => {
    const priceMatch = rawText.match(/\$(\d+(?:\.\d{2})?)/);
    const price = priceMatch ? `$${priceMatch[1]}` : "";
    if (!priceMatch) return { title: rawText, price };
    const before = rawText.slice(0, priceMatch.index).trim();
    const after = rawText.slice(priceMatch.index! + priceMatch[0].length).trim();
    const title = [before, after].filter(Boolean).join(" ").trim();
    return { title, price };
  };

  const seen = new Set<string>();
  const results: DepopTileRaw[] = [];

  for (const anchorEl of Array.from(document.querySelectorAll("a[href*='/products/']"))) {
    const link = anchorEl as HTMLAnchorElement;
    const href = link.href;

    const match = href.match(/\/products\/([^/?#]+)/);
    const slug = match ? match[1] : null;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const container = resolveContainer(link);
    const rawText = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const { title, price } = stripPrice(rawText);
    const imageEl = container.querySelector("img") as HTMLImageElement | null;

    results.push({
      id: slug,
      slug,
      // Best-effort: price-stripped remainder text. Depop doesn't follow
      // Poshmark's fixed "Brand Men's Title" sentence pattern, and the exact
      // per-tile text layout (where brand/size fragments sit relative to the
      // title) wasn't confirmed in the live check — see
      // docs/depop-scraper-fix/investigation-findings.md for what was and
      // wasn't captured. Returning an honest title+price+url beats guessing
      // at a brittle brand/size split that could silently be wrong.
      title: title || rawText,
      price,
      brand: null,
      size: "",
      url: href,
      image: imageEl?.src ?? null,
    });
  }

  return results;
}
