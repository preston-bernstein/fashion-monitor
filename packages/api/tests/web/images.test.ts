import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { SearchGroupsRepo } from "@fm/core/storage/repos/search-groups.js";
import { SeenListingsRepo } from "@fm/core/storage/repos/seen-listings.js";
import type { Listing } from "@fm/core/core/types.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";

function sampleListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: "abc123",
    platform: "ebay",
    title: "Helmut Lang Wool Crewneck XXL",
    description: "Black slub cotton, relaxed fit.",
    price: 85,
    currency: "USD",
    size: "XXL",
    brand: "Helmut Lang",
    url: "https://example.com/listing",
    imageUrl: "https://i.ebayimg.com/image.jpg",
    listedAt: new Date("2025-01-01"),
    condition: "excellent",
    raw: {},
    ...overrides,
  };
}

describe("monitor and listing images API", () => {
  let db: Db;
  let app: FastifyInstance;
  let client: TestClient;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "curator@example.com", "pw-curator-1", "curator");
    app = await buildTestApp(db);
    client = new TestClient(app);
    const login = await client.login("curator@example.com", "pw-curator-1");
    expect(login.statusCode).toBe(200);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("lists curated and fallback monitor images", async () => {
    const seen = new SeenListingsRepo(db, "default");
    const now = new Date().toISOString();

    await client.post("/api/monitors", {
      id: "jacket-watch",
      query_text: "corduroy jacket",
      platforms: ["ebay"],
      status: "active",
      enabled: true,
    });

    seen.markSeen(
      sampleListing({
        id: "ebay-1",
        sourceQueryId: "jacket-watch",
        imageUrl: "https://i.ebayimg.com/fallback.jpg",
      }),
      "YES",
      now,
    );

    const list = await client.get("/api/monitors/jacket-watch/images");
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      curated: unknown[];
      fallback: Array<{ url: string }>;
    };
    expect(body.curated).toHaveLength(0);
    expect(body.fallback[0]?.url).toBe("https://i.ebayimg.com/fallback.jpg");

    const add = await client.post("/api/monitors/jacket-watch/images", {
      source: "listing",
      platform: "ebay",
      listing_id: "ebay-1",
    });
    expect(add.statusCode).toBe(201);

    const after = await client.get("/api/monitors/jacket-watch/images");
    const afterBody = after.json() as { curated: Array<{ url: string }> };
    expect(afterBody.curated).toHaveLength(1);
    expect(afterBody.curated[0]?.url).toBe("https://i.ebayimg.com/fallback.jpg");
  });

  it("auto-picks only YES/MAYBE listings, YES ranked ahead of MAYBE", async () => {
    const seen = new SeenListingsRepo(db, "default");
    const now = new Date().toISOString();

    await client.post("/api/monitors", {
      id: "auto-pick-watch",
      query_text: "corduroy jacket",
      platforms: ["ebay"],
      status: "active",
      enabled: true,
    });

    seen.markSeen(
      sampleListing({
        id: "rejected-1",
        sourceQueryId: "auto-pick-watch",
        imageUrl: "https://i.ebayimg.com/no.jpg",
      }),
      "NO",
      now,
    );
    seen.markPending(
      sampleListing({
        id: "pending-1",
        sourceQueryId: "auto-pick-watch",
        imageUrl: "https://i.ebayimg.com/pending.jpg",
      }),
      now,
    );
    seen.markSeen(
      sampleListing({
        id: "maybe-1",
        sourceQueryId: "auto-pick-watch",
        imageUrl: "https://i.ebayimg.com/maybe.jpg",
      }),
      "MAYBE",
      now,
    );
    seen.markSeen(
      sampleListing({
        id: "yes-1",
        sourceQueryId: "auto-pick-watch",
        imageUrl: "https://i.ebayimg.com/yes.jpg",
      }),
      "YES",
      now,
    );

    const res = await client.get("/api/monitors/auto-pick-watch/images");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { fallback: Array<{ url: string; score: string | null }> };

    expect(body.fallback).toHaveLength(2);
    expect(body.fallback.map((f) => f.url)).toEqual([
      "https://i.ebayimg.com/yes.jpg",
      "https://i.ebayimg.com/maybe.jpg",
    ]);
    expect(body.fallback.every((f) => f.score === "YES" || f.score === "MAYBE")).toBe(true);
  });

  it("returns listing images and removes curated entries", async () => {
    const seen = new SeenListingsRepo(db, "default");
    const now = new Date().toISOString();
    const groups = new SearchGroupsRepo(db, "default");

    groups.createGroup(
      {
        id: "gallery",
        query_text: "test",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      now,
    );

    seen.markSeen(
      sampleListing({
        id: "item-9",
        imageUrl: "https://i.ebayimg.com/item.jpg",
        raw: { additionalImages: [{ imageUrl: "https://i.ebayimg.com/alt.jpg" }] },
      }),
      "YES",
      now,
    );

    const listingImages = await client.get("/api/listings/ebay/item-9/images");
    expect(listingImages.statusCode).toBe(200);
    const listingBody = listingImages.json() as { images: Array<{ url: string }> };
    expect(listingBody.images).toHaveLength(2);

    const add = await client.post("/api/monitors/gallery/images", {
      source: "url",
      url: "https://i.ebayimg.com/manual.jpg",
    });
    const imageId = (add.json() as { image: { id: number } }).image.id;

    const del = await client.del(`/api/monitors/gallery/images/${imageId}`);
    expect(del.statusCode).toBe(200);

    const list = await client.get("/api/monitors/gallery/images");
    expect((list.json() as { curated: unknown[] }).curated).toHaveLength(0);
  });
});
