import { describe, expect, it } from "vitest";
import { prefilterListings } from "../../src/pipeline/prefilter.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";

describe("prefilter gate matrix", () => {
  it("rejects blocklist brand", () => {
    const { rejected } = prefilterListings(
      [sampleListing({ brand: "Shein", title: "Shirt" })],
      minimalConfig,
    );
    expect(rejected[0]?.reason).toBe("blocklist_brand");
  });

  it("rejects blocklist keyword", () => {
    const { rejected } = prefilterListings(
      [sampleListing({ title: "Vintage replica blazer", brand: "Unknown" })],
      minimalConfig,
    );
    expect(rejected[0]?.reason).toBe("blocklist_keyword");
  });

  it("rejects synthetic fabric", () => {
    const { rejected } = prefilterListings(
      [
        sampleListing({
          title: "Shirt",
          description: "100% polyester blend, relaxed fit",
          brand: "Unknown",
        }),
      ],
      minimalConfig,
    );
    expect(rejected[0]?.reason).toBe("synthetic_fabric");
  });

  it("rejects brand price floor", () => {
    const { rejected } = prefilterListings(
      [sampleListing({ brand: "Helmut Lang", price: 25, title: "Tee" })],
      minimalConfig,
    );
    expect(rejected[0]?.reason).toBe("price_floor");
  });

  it("rejects price ceiling by category", () => {
    const { rejected } = prefilterListings(
      [sampleListing({ title: "Wool overcoat", price: 900, brand: "Unknown" })],
      minimalConfig,
    );
    expect(rejected[0]?.reason).toBe("price_ceiling");
  });

  it("rejects hard_no rules from config", () => {
    const config = { ...minimalConfig, hard_no: ["cargo pockets"] };
    const { rejected } = prefilterListings(
      [sampleListing({ title: "Cargo pockets utility jacket", brand: "Unknown" })],
      config,
    );
    expect(rejected[0]?.reason).toBe("hard_no");
  });

  it("passes listing that clears all gates", () => {
    const { passed } = prefilterListings([sampleListing()], minimalConfig);
    expect(passed).toHaveLength(1);
  });
});
