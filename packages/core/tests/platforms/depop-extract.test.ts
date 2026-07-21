import { describe, expect, it } from "vitest";
import { extractDepopTilesFromHtml, parseDepopTileText } from "../../src/platforms/depop/extract.js";

describe("parseDepopTileText", () => {
  it("extracts a price from the middle of the text and strips it from the title", () => {
    const { title, price } = parseDepopTileText("Vintage Nike Tee $13.00 Size M");
    expect(price).toBe("$13.00");
    expect(title).toBe("Vintage Nike Tee Size M");
  });

  it("returns an empty price and the full normalized text as title when there's no price", () => {
    const { title, price } = parseDepopTileText("Vintage Nike Tee Size M");
    expect(price).toBe("");
    expect(title).toBe("Vintage Nike Tee Size M");
  });

  it("collapses repeated whitespace and newlines into single spaces, and trims", () => {
    const { title, price } = parseDepopTileText("  Vintage\n\nNike   Tee \n $13.00\n  Size M  ");
    expect(price).toBe("$13.00");
    expect(title).toBe("Vintage Nike Tee Size M");
  });

  it("handles the price at the very start of the text", () => {
    const { title, price } = parseDepopTileText("$13.00 Vintage Nike Tee");
    expect(price).toBe("$13.00");
    expect(title).toBe("Vintage Nike Tee");
  });

  it("handles the price at the very end of the text", () => {
    const { title, price } = parseDepopTileText("Vintage Nike Tee $13.00");
    expect(price).toBe("$13.00");
    expect(title).toBe("Vintage Nike Tee");
  });

  it("matches a price with no decimal component (e.g. $13)", () => {
    const { title, price } = parseDepopTileText("Vintage Nike Tee $13 Size M");
    expect(price).toBe("$13");
    expect(title).toBe("Vintage Nike Tee Size M");
  });

  // No price present, so the price-stripping branch's own trim() calls never
  // run — this is the one case that actually distinguishes whether the
  // top-level `.trim()` on `normalized` ran at all (with a price present,
  // `before`/`after` are independently trimmed regardless, which is why the
  // "price at start/end" cases above can't tell the difference — verified via
  // mutation testing: removing filter(Boolean) at the join step is masked by
  // the trailing .trim() in every case, since an empty joined segment plus a
  // separator space is always trimmed away identically either way).
  it("trims leading/trailing whitespace even when there's no price to strip", () => {
    const { title, price } = parseDepopTileText("   Vintage Nike Tee   ");
    expect(price).toBe("");
    expect(title).toBe("Vintage Nike Tee");
  });
});

describe("extractDepopTilesFromHtml", () => {
  const baseUrl = "https://www.depop.com/search/?q=vintage";

  it("resolves a relative href and a relative img src against baseUrl", () => {
    const html = `
      <ul>
        <li>
          <a href="/products/vintage-band-tee/">
            <img src="/images/tee.jpg" />
            <span>Vintage   Band\n\nTee $13.00 Size M</span>
          </a>
        </li>
      </ul>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      id: "vintage-band-tee",
      slug: "vintage-band-tee",
      // Multiple consecutive whitespace/newlines between "Vintage" and "Band"
      // and "Band"/"Tee" collapse to single spaces, confirming the container
      // text's own \s+ collapse (not just parseDepopTileText's internal one).
      title: "Vintage Band Tee Size M",
      price: "$13.00",
      url: "https://www.depop.com/products/vintage-band-tee/",
      image: "https://www.depop.com/images/tee.jpg",
      brand: null,
      size: "",
    });
  });

  it("leaves an already-absolute href/img src resolved to the same absolute URL", () => {
    const html = `
      <li>
        <a href="https://www.depop.com/products/other-item/">
          <img src="https://depop-media.example/other.jpg" />
          <span>Other Item $20.00</span>
        </a>
      </li>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].url).toBe("https://www.depop.com/products/other-item/");
    expect(tiles[0].image).toBe("https://depop-media.example/other.jpg");
  });

  it("returns image: null (the null-image guard) when the tile has no img element", () => {
    const html = `
      <li>
        <a href="/products/no-image-item/">
          <span>No Image Item $9.00</span>
        </a>
      </li>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].image).toBeNull();
    expect(tiles[0].url).toBe("https://www.depop.com/products/no-image-item/");
  });

  it("returns image: null when the img element has no src attribute at all", () => {
    const html = `
      <li>
        <a href="/products/empty-src-item/">
          <img />
          <span>Empty Src Item $9.00</span>
        </a>
      </li>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].image).toBeNull();
  });

  it("dedupes multiple anchors pointing at the same product slug", () => {
    const html = `
      <li>
        <a href="/products/dup-item/">
          <img src="/images/dup-1.jpg" />
          <span>Dup Item $5.00</span>
        </a>
        <a href="/products/dup-item/?ref=thumb">
          <img src="/images/dup-2.jpg" />
        </a>
      </li>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].slug).toBe("dup-item");
  });

  it("returns an empty array when no product anchors are present", () => {
    const tiles = extractDepopTilesFromHtml("<div>no results</div>", baseUrl);
    expect(tiles).toEqual([]);
  });

  // Every fixture above nests the anchor directly inside its <li>/<article>
  // container boundary, so resolveContainer()'s ancestor-walk loop always
  // breaks on its first iteration — never actually walking up multiple
  // levels. This fixture nests the anchor two plain <div>s deep inside the
  // <li>, forcing the walk to climb past non-boundary wrappers and pick up
  // the tile's title/image text from the <li> container, not from one of the
  // inner divs (which contain none of it).
  it("walks up multiple non-boundary ancestor levels to find the li/article container", () => {
    const html = `
      <li>
        <div>
          <div>
            <a href="/products/nested-item/"></a>
          </div>
        </div>
        <img src="/images/nested.jpg" />
        <span>Nested Item $9.00</span>
      </li>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      slug: "nested-item",
      title: "Nested Item",
      price: "$9.00",
      image: "https://www.depop.com/images/nested.jpg",
    });
  });

  // A card-class div (not li/article) also counts as a container boundary —
  // confirms isContainerBoundary's class-based check, not just the tag check.
  it("recognizes a card-class div (not li/article) as a container boundary", () => {
    const html = `
      <div class="styles_card__xyz">
        <a href="/products/card-item/"></a>
        <img src="/images/card.jpg" />
        <span>Card Item $7.00</span>
      </div>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      slug: "card-item",
      title: "Card Item",
      price: "$7.00",
    });
  });

  // If the ancestor walk exceeds its 3-level cap without hitting a boundary,
  // it stops at whatever the third ancestor is rather than climbing forever —
  // confirms the loop bound itself (i < 3), not just the boundary check.
  it("stops climbing after 3 ancestor levels even without hitting a boundary", () => {
    const html = `
      <div id="outer-no-boundary">
        <div>
          <div>
            <div>
              <a href="/products/deep-item/"></a>
            </div>
          </div>
        </div>
        <span>This text is outside the 3-level walk and must NOT be picked up</span>
      </div>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles).toHaveLength(1);
    // Title falls back to the anchor's own (empty) text, NOT the outer
    // <span> text — proving the walk stopped at 3 levels rather than
    // climbing all the way up to #outer-no-boundary.
    expect(tiles[0].title).toBe("");
  });

  // Regression test for a retired behavior: the old (now-retired) Playwright-driven
  // Depop scraper used to click a OneTrust cookie-consent-accept banner
  // (`#onetrust-accept-btn-handler, button:has-text("Accept all")`) before extracting
  // tiles. The sidecar-based rewrite has NO click primitive available at all, so that
  // click is gone for good — resting on the assumption that getContent() returns the
  // full rendered DOM regardless of whether the banner was dismissed (i.e. the banner
  // is a visual overlay, not something that blocks tile markup from existing/rendering
  // in the DOM). This test exists to verify that assumption instead of just asserting it.
  //
  // Fixture provenance: a live fetch was attempted first (`curl` against
  // https://www.depop.com/search/?q=vintage from this sandboxed task-agent
  // environment) and came back HTTP 403 — Depop's bot/edge protection blocking the
  // request outright, not something worth fighting for a single test fixture. Per the
  // task's fallback guidance, this is a CONSTRUCTED SYNTHETIC fixture instead of
  // captured real HTML. It is built directly from the real extraction logic read out
  // of extract.ts (the a[href*='/products/'] selector + the resolveContainer()
  // ancestor walk that stops at the first li/article/card-class-div, max 3 levels up)
  // and from a realistic OneTrust banner shape (id="onetrust-banner-sdk" wrapper
  // containing #onetrust-accept-btn-handler), matching how OneTrust actually renders
  // in production on sites that use it. Limitation: this is not a byte-for-byte
  // capture of Depop's real page, so it can't catch a Depop-specific interaction
  // between their exact markup and the banner; it does prove the general shape (tile
  // anchors + ancestor container existing in the DOM alongside an undismissed banner
  // overlay) doesn't block extraction, which is the assumption this task was scoped
  // to check.
  it("extracts a non-zero count of real tiles even with an undismissed OneTrust cookie banner present in the DOM", () => {
    const html = `
      <div id="onetrust-consent-sdk">
        <div id="onetrust-banner-sdk" class="otFlat bottom" style="position: fixed; z-index: 2147483647;">
          <div class="ot-sdk-container">
            <div class="ot-sdk-row">
              <div id="onetrust-group-container">
                <div id="onetrust-policy">
                  <h2 id="onetrust-policy-title">We use cookies</h2>
                  <div id="onetrust-policy-text">
                    We and our partners use cookies to enhance your browsing experience.
                  </div>
                </div>
              </div>
              <div id="onetrust-button-group-parent">
                <div id="onetrust-button-group">
                  <button id="onetrust-reject-all-handler">Reject All</button>
                  <button id="onetrust-accept-btn-handler">Accept all</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <main>
        <ul class="depop-search-results">
          <li class="styles_card__abc123">
            <a href="/products/vintage-levis-501/">
              <img src="/images/levis-501.jpg" />
              <span>Vintage Levi's 501 $45.00 Size 32</span>
            </a>
          </li>
          <li class="styles_card__abc123">
            <a href="/products/carhartt-jacket/">
              <img src="/images/carhartt.jpg" />
              <span>Carhartt Detroit Jacket $80.00 Size L</span>
            </a>
          </li>
          <article>
            <a href="/products/nike-windbreaker/">
              <img src="/images/nike-windbreaker.jpg" />
              <span>Nike Windbreaker $30.00 Size M</span>
            </a>
          </article>
        </ul>
      </main>
    `;

    const tiles = extractDepopTilesFromHtml(html, baseUrl);

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => tile.slug)).toEqual([
      "vintage-levis-501",
      "carhartt-jacket",
      "nike-windbreaker",
    ]);
  });
});
