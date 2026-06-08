import { describe, expect, it } from "vitest";
import {
  serializeListing,
  deserializeListing,
  mergeListings,
} from "../../src/storage/listing-snapshot.js";
import { sampleListing } from "../helpers/fixtures.js";

describe("listing snapshot", () => {
  it("round-trips listing JSON", () => {
    const listing = sampleListing();
    const restored = deserializeListing(serializeListing(listing));
    expect(restored.id).toBe(listing.id);
    expect(restored.platform).toBe(listing.platform);
    expect(restored.listedAt?.toISOString()).toBe(listing.listedAt?.toISOString());
  });

  it("mergeListings prefers later duplicate keys", () => {
    const a = sampleListing({ id: "1", price: 50 });
    const b = sampleListing({ id: "1", price: 99 });
    const merged = mergeListings([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].price).toBe(99);
  });
});
