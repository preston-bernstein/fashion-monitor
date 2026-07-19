import { describe, expect, it } from "vitest";
import { parseDepopTileText } from "../../src/platforms/depop/extract.js";

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
