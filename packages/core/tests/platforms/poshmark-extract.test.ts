import { describe, expect, it } from "vitest";
import {
  extractPoshmarkTilesFromHtml,
  parsePoshmarkMetaText,
} from "../../src/platforms/poshmark/extract.js";

describe("parsePoshmarkMetaText edge cases", () => {
  it("returns an empty price and size when there's no dollar amount at all", () => {
    const parsed = parsePoshmarkMetaText("John Varvatos Men's Dark Corduroy Shirt Jacket");
    expect(parsed.price).toBe("");
    expect(parsed.size).toBe("");
    expect(parsed.brand).toBe("John Varvatos Men's");
    expect(parsed.title).toBe("Dark Corduroy Shirt Jacket");
  });

  it("leaves brand null and keeps the full pre-price text as title when there's no Men's marker", () => {
    const parsed = parsePoshmarkMetaText("Dark Corduroy Shirt Jacket $67 XXL");
    expect(parsed.brand).toBeNull();
    expect(parsed.title).toBe("Dark Corduroy Shirt Jacket");
    expect(parsed.price).toBe("$67");
    expect(parsed.size).toBe("XXL");
  });

  it("collapses internal whitespace/newlines before parsing", () => {
    const parsed = parsePoshmarkMetaText("  Dark   Corduroy\n Jacket   $67   XXL  ");
    expect(parsed.title).toBe("Dark Corduroy Jacket");
    expect(parsed.price).toBe("$67");
  });

  it("matches a decimal price", () => {
    const parsed = parsePoshmarkMetaText("Dark Corduroy Jacket $67.50 XXL");
    expect(parsed.price).toBe("$67.50");
  });

  it("takes the last whitespace-separated token after the price as size", () => {
    const parsed = parsePoshmarkMetaText("Dark Corduroy Jacket $67 Size XXL");
    expect(parsed.size).toBe("XXL");
  });
});

describe("extractPoshmarkTilesFromHtml", () => {
  const BASE_URL = "https://poshmark.com/search?query=corduroy";

  function tileHtml(
    opts: {
      id?: string;
      href?: string;
      imgSrc?: string;
      text?: string;
      covershotClass?: "tile-grid-redesign__covershot" | "tile__covershot";
    } = {},
  ) {
    const {
      id = "pm-111",
      href = "/listing/pm-111",
      imgSrc = "/img/pm-111.jpg",
      text = "John Varvatos Men's Dark Corduroy Shirt Jacket $67 XXL",
      covershotClass = "tile-grid-redesign__covershot",
    } = opts;
    return `
      <div class="tile">
        <a class="${covershotClass}" data-et-prop-listing_id="${id}" href="${href}">
          <img src="${imgSrc}" />
        </a>
        <a class="tile-grid-redesign__meta-link" data-et-prop-listing_id="${id}" href="${href}">
          ${text}
        </a>
      </div>
    `;
  }

  it("resolves a relative href/src against baseUrl into absolute URLs", () => {
    const html = tileHtml();
    const [tile] = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tile.url).toBe("https://poshmark.com/listing/pm-111");
    expect(tile.image).toBe("https://poshmark.com/img/pm-111.jpg");
  });

  it("leaves an already-absolute href/src unchanged (still resolved via URL, but pointing at its own origin)", () => {
    const html = tileHtml({
      href: "https://cdn.poshmark.com/listing/pm-111",
      imgSrc: "https://cdn.poshmark.com/img/pm-111.jpg",
    });
    const [tile] = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tile.url).toBe("https://cdn.poshmark.com/listing/pm-111");
    expect(tile.image).toBe("https://cdn.poshmark.com/img/pm-111.jpg");
  });

  it("parses id/title/price/brand/size out of the meta link text", () => {
    const html = tileHtml();
    const [tile] = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tile.id).toBe("pm-111");
    expect(tile.brand).toBe("John Varvatos Men's");
    expect(tile.title).toBe("Dark Corduroy Shirt Jacket");
    expect(tile.price).toBe("$67");
    expect(tile.size).toBe("XXL");
  });

  it("falls back to the raw text as title when meta parsing yields an empty title", () => {
    const html = tileHtml({ text: "$67 XXL" });
    const [tile] = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tile.title).toBe("$67 XXL");
  });

  it("matches the legacy tile__covershot image selector as well as tile-grid-redesign__covershot", () => {
    const html = tileHtml({ covershotClass: "tile__covershot" });
    const [tile] = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tile.image).toBe("https://poshmark.com/img/pm-111.jpg");
  });

  it("returns image: null when no matching covershot image element exists", () => {
    const html = `
      <a class="tile-grid-redesign__meta-link" data-et-prop-listing_id="pm-999" href="/listing/pm-999">
        No Image Item $50 L
      </a>
    `;
    const [tile] = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tile.image).toBeNull();
  });

  it("skips a meta-link entirely when it has no href", () => {
    const html = `
      <a class="tile-grid-redesign__meta-link" data-et-prop-listing_id="pm-222">
        No Href Item $50 L
      </a>
    `;
    const tiles = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tiles).toEqual([]);
  });

  it("dedupes multiple meta-links sharing the same listing id, keeping only the first", () => {
    const html = tileHtml() + tileHtml({ text: "Duplicate $67 XXL" });
    const tiles = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tiles).toHaveLength(1);
    expect(tiles[0].title).toBe("Dark Corduroy Shirt Jacket");
  });

  it("extracts multiple distinct tiles from a page of results", () => {
    const html =
      tileHtml({ id: "pm-1", href: "/listing/pm-1", text: "First Item $10 S" }) +
      tileHtml({ id: "pm-2", href: "/listing/pm-2", text: "Second Item $20 M" });
    const tiles = extractPoshmarkTilesFromHtml(html, BASE_URL);

    expect(tiles).toHaveLength(2);
    expect(tiles.map((t) => t.id)).toEqual(["pm-1", "pm-2"]);
  });

  it("returns an empty array when the html has no matching meta-link elements", () => {
    expect(extractPoshmarkTilesFromHtml("<div>no results</div>", BASE_URL)).toEqual([]);
  });
});
