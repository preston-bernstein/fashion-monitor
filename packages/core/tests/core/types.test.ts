import { describe, expect, it } from "vitest";
import { prepareForLLM } from "../../src/core/types.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("prepareForLLM", () => {
  it("truncates long descriptions", () => {
    const listing = sampleListing({ description: "x".repeat(600) });
    const prepared = prepareForLLM(listing);
    expect(prepared.description.length).toBeLessThanOrEqual(503);
    expect(prepared.description.endsWith("...")).toBe(true);
  });

  it("uses listing key format", () => {
    const prepared = prepareForLLM(sampleListing());
    expect(prepared.listing_id).toBe("ebay:abc123");
  });
});
