import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { AlertLogRepo } from "@fm/core/storage/repos/alert-log.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import type { Listing, ScoringResult } from "@fm/core/core/types.js";
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
    sourceQueryId: "ebay-corduroy-jacket",
    ...overrides,
  };
}

function sampleResult(overrides: Partial<ScoringResult> = {}): ScoringResult {
  return {
    listing_id: "ebay:abc123",
    score: "YES",
    quality: "pass",
    value: "pass",
    aesthetic: "pass",
    size: "HIGH",
    reason: "Great match",
    ...overrides,
  };
}

function auditActions(db: Db): string[] {
  return new AuditLogRepo(db, "default").fetchRecent(100).map((row) => row.action);
}

describe("feedback API", () => {
  let db: Db;
  let app: FastifyInstance;
  let client: TestClient;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    await createUser(db, "curator@example.com", "pw-curator-1", "curator");
    await createUser(db, "viewer@example.com", "pw-viewer-1", "viewer");
    new AlertLogRepo(db, "default").insert(
      sampleListing(),
      sampleResult(),
      new Date().toISOString(),
    );
    app = await buildTestApp(db);
    client = new TestClient(app);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it("rejects unauthenticated requests", async () => {
    const res = await client.post("/api/feedback", {
      platform: "ebay",
      listing_id: "abc123",
      signal: "positive",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a role without feedback:write", async () => {
    await client.login("viewer@example.com", "pw-viewer-1");
    const res = await client.post("/api/feedback", {
      platform: "ebay",
      listing_id: "abc123",
      signal: "positive",
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects missing CSRF token on a mutating request", async () => {
    await client.login("curator@example.com", "pw-curator-1");
    const res = await client.inject({
      method: "POST",
      url: "/api/feedback",
      payload: { platform: "ebay", listing_id: "abc123", signal: "positive" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("records feedback with lineage copied from the matching alert", async () => {
    await client.login("curator@example.com", "pw-curator-1");
    const res = await client.post("/api/feedback", {
      platform: "ebay",
      listing_id: "abc123",
      signal: "positive",
    });
    expect(res.statusCode).toBe(201);

    const row = db
      .prepare(
        `SELECT profile_id, signal, source_query_id, title, brand, price FROM feedback ORDER BY recorded_at DESC LIMIT 1`,
      )
      .get() as {
      profile_id: string;
      signal: string;
      source_query_id: string | null;
      title: string | null;
      brand: string | null;
      price: number | null;
    };

    expect(row.profile_id).toBe("default");
    expect(row.signal).toBe("positive");
    expect(row.source_query_id).toBe("ebay-corduroy-jacket");
    expect(row.title).toBe("Helmut Lang Wool Crewneck XXL");
    expect(row.brand).toBe("Helmut Lang");
    expect(row.price).toBe(85);
  });

  it("records a feedback.record audit entry", async () => {
    await client.login("curator@example.com", "pw-curator-1");
    await client.post("/api/feedback", {
      platform: "ebay",
      listing_id: "abc123",
      signal: "negative",
    });

    expect(auditActions(db)).toContain("feedback.record");
  });

  it("rejects invalid signal values", async () => {
    await client.login("curator@example.com", "pw-curator-1");
    const res = await client.post("/api/feedback", {
      platform: "ebay",
      listing_id: "abc123",
      signal: "meh",
    });
    expect(res.statusCode).toBe(400);
  });
});
