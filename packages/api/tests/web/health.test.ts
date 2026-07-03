import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { RunsRepo } from "@fm/core/storage/repos/runs.js";
import { AlertLogRepo } from "@fm/core/storage/repos/alert-log.js";
import type { Listing } from "@fm/core/core/types.js";
import { buildTestApp, createUser, TestClient } from "../helpers/web.js";
import type { HealthResponse } from "@fm/shared/dto.js";

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
    sourceQueryId: "ebay-corduroy-jacket",
    ...overrides,
  };
}

describe("GET /api/profile-health", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    app = await buildTestApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("is visible to every role (viewer included) via analytics:read", async () => {
    await createUser(db, "viewer@example.com", "pw-viewer-123", "viewer");
    const client = new TestClient(app);
    await client.login("viewer@example.com", "pw-viewer-123");
    const res = await client.get("/api/profile-health");
    expect(res.statusCode).toBe(200);
  });

  it("returns the funnel newest-first with prefiltered counts and the last alert timestamp", async () => {
    await createUser(db, "owner@example.com", "pw-owner-123", "owner");
    const runs = new RunsRepo(db, "default");
    const alerts = new AlertLogRepo(db, "default");

    const id1 = runs.start("2026-01-01T00:00:00.000Z");
    runs.finish(
      id1,
      "2026-01-01T00:05:00.000Z",
      {
        listingsFound: 10,
        listingsNew: 6,
        prefilterRejected: 2,
        scoredYes: 1,
        scoredMaybe: 1,
        scoredNo: 2,
        alertsSent: 1,
        errors: [],
      },
      null,
    );
    const id2 = runs.start("2026-01-02T00:00:00.000Z");
    runs.finish(
      id2,
      "2026-01-02T00:05:00.000Z",
      {
        listingsFound: 4,
        listingsNew: 4,
        prefilterRejected: 0,
        scoredYes: 0,
        scoredMaybe: 0,
        scoredNo: 4,
        alertsSent: 0,
        errors: [],
      },
      "boom",
    );
    alerts.insert(
      sampleListing({ id: "1" }),
      {
        listing_id: "ebay:1",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Good match",
      },
      "2026-01-01T12:00:00.000Z",
    );

    const client = new TestClient(app);
    await client.login("owner@example.com", "pw-owner-123");
    const res = await client.get("/api/profile-health");
    expect(res.statusCode).toBe(200);
    const body = res.json() as HealthResponse;

    expect(body.runs.map((r) => r.id)).toEqual([id2, id1]);
    expect(body.runs[1].prefiltered).toBe(2);
    expect(body.runs[0].hadError).toBe(true);
    expect(body.runs[1].hadError).toBe(false);
    expect(body.lastAlertedAt).toBe("2026-01-01T12:00:00.000Z");
  });

  it("does not leak another profile's runs or alerts", async () => {
    await createUser(db, "owner1@example.com", "pw-owner1-123", "owner", "p1");
    await createUser(db, "owner2@example.com", "pw-owner2-123", "owner", "p2");

    const runsP2 = new RunsRepo(db, "p2");
    const idP2 = runsP2.start("2026-01-05T00:00:00.000Z");
    runsP2.finish(
      idP2,
      "2026-01-05T00:05:00.000Z",
      {
        listingsFound: 1,
        listingsNew: 1,
        prefilterRejected: 0,
        scoredYes: 1,
        scoredMaybe: 0,
        scoredNo: 0,
        alertsSent: 1,
        errors: [],
      },
      null,
    );
    new AlertLogRepo(db, "p2").insert(
      sampleListing({ id: "p2-listing" }),
      {
        listing_id: "ebay:p2",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Good match",
      },
      "2026-01-05T12:00:00.000Z",
    );

    const client = new TestClient(app);
    await client.login("owner1@example.com", "pw-owner1-123");
    const res = await client.get("/api/profile-health");
    const body = res.json() as HealthResponse;

    expect(body.runs).toHaveLength(0);
    expect(body.lastAlertedAt).toBeNull();
  });
});
