import { describe, expect, it, afterEach } from "vitest";
import { openDatabase, type Db } from "../../src/storage/db.js";
import { RunsRepo } from "../../src/storage/repos/runs.js";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { AlertLogRepo } from "../../src/storage/repos/alert-log.js";
import { SearchGroupsRepo } from "../../src/storage/repos/search-groups.js";
import { sampleListing, minimalConfig } from "../helpers/fixtures.js";

/**
 * Phase 2 gate (fashion-monitor-multi-profile-campaign): prove rows written
 * under one profile are invisible through another profile's repo instance,
 * before a real second tenant exists.
 */
describe("cross-profile isolation", () => {
  let db: Db;

  afterEach(() => {
    db?.close();
  });

  it("hides p1 runs from a p2-scoped RunsRepo", () => {
    db = openDatabase(":memory:");
    const now = new Date().toISOString();
    const p1 = new RunsRepo(db, "p1");
    const p2 = new RunsRepo(db, "p2");

    const p1RunId = p1.start(now);

    expect(db.prepare(`SELECT * FROM runs WHERE profile_id = ?`).all("p1")).toHaveLength(1);
    expect(db.prepare(`SELECT * FROM runs WHERE profile_id = ?`).all("p2")).toHaveLength(0);

    // p2's own writer can't be tricked into touching p1's row by id alone.
    p2.finish(
      p1RunId,
      now,
      {
        listingsFound: 0,
        listingsNew: 0,
        scoredYes: 0,
        scoredMaybe: 0,
        scoredNo: 0,
        alertsSent: 0,
        prefilterRejected: 0,
        errors: [],
      },
      "should not apply",
    );
    const p1After = db.prepare(`SELECT error FROM runs WHERE profile_id = ?`).get("p1") as {
      error: string | null;
    };
    expect(p1After.error).toBeNull();
  });

  it("hides p1 pending listings from a p2-scoped SeenListingsRepo", () => {
    db = openDatabase(":memory:");
    const now = new Date().toISOString();
    const p1 = new SeenListingsRepo(db, "p1");
    const p2 = new SeenListingsRepo(db, "p2");

    p1.markPending(sampleListing({ id: "leak-1", platform: "ebay" }), now);

    expect(p1.fetchPendingListings()).toHaveLength(1);
    expect(p2.fetchPendingListings()).toHaveLength(0);
  });

  it("hides p1 feedback from a p2-scoped FeedbackRepo", () => {
    db = openDatabase(":memory:");
    const now = new Date().toISOString();
    const p1 = new FeedbackRepo(db, "p1");
    const p2 = new FeedbackRepo(db, "p2");

    p1.insert({ platform: "ebay", listing_id: "leak-1", signal: "positive", title: "Test" }, now);

    expect(p1.fetchRecent("positive", 10)).toHaveLength(1);
    expect(p2.fetchRecent("positive", 10)).toHaveLength(0);
  });

  it("hides p1 alerts from a p2-scoped AlertLogRepo", () => {
    db = openDatabase(":memory:");
    const now = new Date().toISOString();
    const p1 = new AlertLogRepo(db, "p1");
    const p2 = new AlertLogRepo(db, "p2");
    const listing = sampleListing({ id: "leak-1", platform: "ebay" });

    p1.insert(
      listing,
      {
        listing_id: "leak-1",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "r",
      },
      now,
    );

    expect(p1.findLatest("ebay", "leak-1")).toBeDefined();
    expect(p2.findLatest("ebay", "leak-1")).toBeUndefined();
  });

  it("hides p1 search groups/monitors from a p2-scoped SearchGroupsRepo", () => {
    db = openDatabase(":memory:");
    const now = new Date().toISOString();
    const p1 = new SearchGroupsRepo(db, "p1");
    const p2 = new SearchGroupsRepo(db, "p2");

    p1.syncFromConfig(minimalConfig, now);

    expect(p1.listGroups().length).toBeGreaterThan(0);
    expect(p2.listGroups()).toHaveLength(0);
  });
});
