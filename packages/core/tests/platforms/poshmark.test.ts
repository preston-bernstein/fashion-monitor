import { describe, expect, it } from "vitest";
import { parsePoshmarkTiles } from "../../src/platforms/poshmark/normalize.js";
import { parsePoshmarkMetaText } from "../../src/platforms/poshmark/extract.js";

describe("poshmark normalize", () => {
  it("parses listing tiles", () => {
    const listings = parsePoshmarkTiles([
      {
        id: "pm-111",
        title: "Dark Corduroy Shirt Jacket",
        price: "$67",
        brand: "John Varvatos",
        size: "XXL",
        url: "https://poshmark.com/listing/pm-111",
        image: "https://example.com/img.jpg",
      },
    ]);
    expect(listings[0].price).toBe(67);
    expect(listings[0].platform).toBe("poshmark");
  });

  it("parses meta link text into title, price, brand, size", () => {
    const parsed = parsePoshmarkMetaText("John Varvatos Men's Dark Corduroy Shirt Jacket $67 XXL");
    expect(parsed).toEqual({
      brand: "John Varvatos Men's",
      title: "Dark Corduroy Shirt Jacket",
      price: "$67",
      size: "XXL",
    });
  });
});
