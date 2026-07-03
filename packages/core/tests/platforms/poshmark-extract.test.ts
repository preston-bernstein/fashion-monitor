import { describe, expect, it } from "vitest";
import { parsePoshmarkMetaText } from "../../src/platforms/poshmark/extract.js";

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
