import { describe, expect, it } from "vitest";
import { extractListingImages } from "../../src/images/extract.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("extractListingImages", () => {
  it("extracts primary image from imageUrl", () => {
    const images = extractListingImages(
      sampleListing({ imageUrl: "https://i.ebayimg.com/sample.jpg" }),
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.url).toBe("https://i.ebayimg.com/sample.jpg");
    expect(images[0]?.position).toBe(0);
  });

  it("extracts eBay gallery URLs from raw additionalImages", () => {
    const images = extractListingImages(
      sampleListing({
        platform: "ebay",
        imageUrl: "https://i.ebayimg.com/primary.jpg",
        raw: {
          additionalImages: [
            { imageUrl: "https://i.ebayimg.com/gallery-1.jpg" },
            { imageUrl: "https://i.ebayimg.com/gallery-2.jpg" },
          ],
        },
      }),
    );
    expect(images.map((img) => img.url)).toEqual([
      "https://i.ebayimg.com/primary.jpg",
      "https://i.ebayimg.com/gallery-1.jpg",
      "https://i.ebayimg.com/gallery-2.jpg",
    ]);
  });

  it("extracts Grailed photos from raw", () => {
    const images = extractListingImages(
      sampleListing({
        platform: "grailed",
        imageUrl: "https://media-assets.grailed.com/cover.jpg",
        raw: {
          photos: [{ url: "https://media-assets.grailed.com/photo-2.jpg" }],
        },
      }),
    );
    expect(images).toHaveLength(2);
  });

  it("drops URLs outside platform allowlist", () => {
    const images = extractListingImages(
      sampleListing({ imageUrl: "https://evil.example.com/bad.jpg" }),
    );
    expect(images).toHaveLength(0);
  });
});
