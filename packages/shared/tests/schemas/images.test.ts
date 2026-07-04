import { describe, expect, it } from "vitest";
import { SearchGroupImageAddInputSchema } from "../../src/schemas/images.js";

describe("SearchGroupImageAddInputSchema", () => {
  it("accepts a valid 'listing' source", () => {
    const result = SearchGroupImageAddInputSchema.safeParse({
      source: "listing",
      platform: "ebay",
      listing_id: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid 'url' source", () => {
    const result = SearchGroupImageAddInputSchema.safeParse({
      source: "url",
      url: "https://example.com/image.jpg",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a 'listing' source missing platform/listing_id", () => {
    const result = SearchGroupImageAddInputSchema.safeParse({ source: "listing" });
    expect(result.success).toBe(false);
  });

  it("rejects a 'listing' source with a url field instead (wrong shape for the discriminator)", () => {
    const result = SearchGroupImageAddInputSchema.safeParse({
      source: "listing",
      url: "https://example.com/image.jpg",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized source discriminator", () => {
    const result = SearchGroupImageAddInputSchema.safeParse({ source: "upload", url: "https://x.com" });
    expect(result.success).toBe(false);
  });

  it("rejects a url source with a non-URL string", () => {
    const result = SearchGroupImageAddInputSchema.safeParse({ source: "url", url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("trims and caps the optional caption", () => {
    const result = SearchGroupImageAddInputSchema.safeParse({
      source: "listing",
      platform: "ebay",
      listing_id: "abc123",
      caption: "  a nice jacket  ",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.source === "listing") {
      expect(result.data.caption).toBe("a nice jacket");
    }
  });
});
