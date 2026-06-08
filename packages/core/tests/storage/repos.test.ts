import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { RunsRepo } from "../../src/storage/repos/runs.js";
import { AlertLogRepo } from "../../src/storage/repos/alert-log.js";
import { sampleListing } from "../helpers/fixtures.js";
import { createTestDb } from "../helpers/db.js";
import type { Db } from "../../src/storage/db.js";

describe("storage repos", () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDb("fm-repos-").db;
  });

  afterEach(() => {
    db.close();
  });

  it("dedupes and tracks scores in seen_listings", () => {
    const repo = new SeenListingsRepo(db, "default");
    const listing = sampleListing();
    const now = new Date().toISOString();

    repo.markSeen(listing, "YES", now);
    expect(repo.hasFinalScore("ebay", "abc123")).toBe(true);

    repo.markSeen(listing, "NO", now);
    expect(repo.findExisting("ebay", "abc123")?.score).toBe("YES");
  });

  it("stores pending snapshots and final scores via insert paths", () => {
    const repo = new SeenListingsRepo(db, "default");
    const now = new Date().toISOString();
    const pending = sampleListing({ id: "pending-1" });
    const scored = sampleListing({ id: "scored-1" });

    repo.markPending(pending, now);
    expect(repo.fetchPendingListings()).toHaveLength(1);

    repo.recordScore(scored, "NO", now);
    expect(repo.findExisting("ebay", "scored-1")?.score).toBe("NO");
  });

  it("stores feedback and runs", () => {
    const feedback = new FeedbackRepo(db, "default");
    const runs = new RunsRepo(db);
    const alerts = new AlertLogRepo(db, "default");

    feedback.insert(
      { platform: "ebay", listing_id: "1", signal: "positive", title: "Test" },
      new Date().toISOString(),
    );
    expect(feedback.fetchRecent("positive", 5)).toHaveLength(1);

    const runId = runs.start(new Date().toISOString());
    runs.finish(
      runId,
      new Date().toISOString(),
      {
        listingsFound: 1,
        listingsNew: 1,
        scoredYes: 1,
        scoredMaybe: 0,
        scoredNo: 0,
        alertsSent: 1,
        prefilterRejected: 0,
        errors: [],
      },
      null,
    );

    const listing = sampleListing();
    alerts.insert(
      listing,
      {
        listing_id: "ebay:abc123",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Good match",
      },
      new Date().toISOString(),
    );
  });
});
