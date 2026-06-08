import { describe, expect, it } from "vitest";
import grailedFixture from "../fixtures/grailed/algolia-response.json";
import { normalizeGrailed } from "../../src/platforms/grailed/normalize.js";

describe("grailed normalize", () => {
  it("normalizes algolia hit", () => {
    const hit = grailedFixture.hits[0] as Record<string, unknown>;
    const listing = normalizeGrailed(hit);
    expect(listing.platform).toBe("grailed");
    expect(listing.brand).toBe("Engineered Garments");
    expect(listing.url).toContain("98765");
  });
});
