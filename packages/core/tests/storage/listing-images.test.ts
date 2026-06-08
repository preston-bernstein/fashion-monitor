import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../../src/storage/db.js";
import { ListingImagesRepo } from "../../src/storage/repos/listing-images.js";
import { SearchGroupImagesRepo } from "../../src/storage/repos/search-group-images.js";
import { SearchGroupsRepo } from "../../src/storage/repos/search-groups.js";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { sampleListing } from "../helpers/fixtures.js";
import { createTestDb } from "../helpers/db.js";

describe("listing and search group images repos", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb("fm-images-").db;
  });

  afterEach(() => {
    db.close();
  });

  it("persists listing images when seen and dedupes by URL hash", () => {
    const seen = new SeenListingsRepo(db, "default");
    const images = new ListingImagesRepo(db, "default");
    const now = new Date().toISOString();
    const listing = sampleListing({
      imageUrl: "https://i.ebayimg.com/primary.jpg",
      raw: { additionalImages: [{ imageUrl: "https://i.ebayimg.com/primary.jpg" }] },
    });

    seen.markSeen(listing, "YES", now);
    const rows = images.listForListing("ebay", listing.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe("https://i.ebayimg.com/primary.jpg");
  });

  it("curates monitor gallery images from listings and URLs", () => {
    const groups = new SearchGroupsRepo(db, "default");
    const seen = new SeenListingsRepo(db, "default");
    const groupImages = new SearchGroupImagesRepo(db, "default");
    const now = new Date().toISOString();

    groups.createGroup(
      {
        id: "corduroy",
        query_text: "corduroy jacket",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      now,
    );

    const listing = sampleListing({
      id: "listing-42",
      sourceQueryId: "corduroy",
      imageUrl: "https://i.ebayimg.com/item.jpg",
    });
    seen.markSeen(listing, "YES", now);

    const fromListing = groupImages.addFromListing("corduroy", "ebay", "listing-42", now);
    const fromUrl = groupImages.addFromUrl(
      "corduroy",
      "https://i.ebayimg.com/manual.jpg",
      now,
      "manual",
    );

    const curated = groupImages.listForGroup("corduroy");
    expect(curated).toHaveLength(2);
    expect(fromListing.url).toBe("https://i.ebayimg.com/item.jpg");
    expect(fromUrl.caption).toBe("manual");

    expect(groupImages.remove(fromListing.id)).toBe(true);
    expect(groupImages.listForGroup("corduroy")).toHaveLength(1);
  });

  it("rejects disallowed curated URLs", () => {
    const groups = new SearchGroupsRepo(db, "default");
    const groupImages = new SearchGroupImagesRepo(db, "default");
    const now = new Date().toISOString();

    groups.createGroup(
      {
        id: "test-group",
        query_text: "test",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      now,
    );

    expect(() =>
      groupImages.addFromUrl("test-group", "https://evil.example.com/x.jpg", now),
    ).toThrow("image_url_not_allowed");
  });
});
