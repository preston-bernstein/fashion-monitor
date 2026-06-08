import { describe, expect, it } from "vitest";
import { classifyPriceCategory, priceCeilingForCategory } from "../../src/pipeline/category.js";
import { prefilterListings } from "../../src/pipeline/prefilter.js";
import { dedupeInMemory, filterUnscored } from "../../src/pipeline/dedupe.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { createMemoryDb } from "../helpers/db.js";

describe("category", () => {
  it("classifies outerwear and pants", () => {
    expect(classifyPriceCategory("Wool Blazer Jacket")).toBe("outerwear");
    expect(classifyPriceCategory("Cotton Chinos")).toBe("pants");
    expect(classifyPriceCategory("Slub Cotton Shirt")).toBe("tops");
  });

  it("applies category ceilings", () => {
    expect(priceCeilingForCategory("outerwear", minimalConfig.price_ceiling)).toBe(500);
  });
});

describe("prefilter", () => {
  it("rejects blocklist brands", () => {
    const listing = sampleListing({ brand: "Zara", title: "Shirt" });
    const { passed, rejected } = prefilterListings([listing], minimalConfig);
    expect(passed).toHaveLength(0);
    expect(rejected[0].reason).toBe("blocklist_brand");
  });

  it("rejects over price ceiling", () => {
    const listing = sampleListing({ price: 600, title: "Wool Coat" });
    const { passed } = prefilterListings([listing], minimalConfig);
    expect(passed).toHaveLength(0);
  });

  it("passes good listings", () => {
    const listing = sampleListing();
    const { passed } = prefilterListings([listing], minimalConfig);
    expect(passed).toHaveLength(1);
  });
});

describe("dedupe", () => {
  it("dedupes in memory by platform:id", () => {
    const a = sampleListing({ id: "1" });
    const b = sampleListing({ id: "1", title: "Duplicate" });
    const result = dedupeInMemory([a, b]);
    expect(result).toHaveLength(1);
  });

  it("skips listings with final scores in db", () => {
    const { db } = createMemoryDb();
    const repo = new SeenListingsRepo(db, "default");
    const listing = sampleListing();
    repo.markSeen(listing, "NO", new Date().toISOString());

    const { newListings, skipped } = filterUnscored([listing], repo);
    expect(newListings).toHaveLength(0);
    expect(skipped).toBe(1);
    db.close();
  });
});
