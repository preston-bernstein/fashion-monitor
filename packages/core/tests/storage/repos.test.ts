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
    const runs = new RunsRepo(db, "default");
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

  it("RunsRepo.recentFunnel persists prefiltered counts, orders newest-first, and is profile-scoped", () => {
    const runsDefault = new RunsRepo(db, "default");
    const runsOther = new RunsRepo(db, "other");

    const id1 = runsDefault.start("2026-01-01T00:00:00.000Z");
    runsDefault.finish(
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

    const id2 = runsDefault.start("2026-01-02T00:00:00.000Z");
    runsDefault.finish(
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

    const otherId = runsOther.start("2026-01-03T00:00:00.000Z");
    runsOther.finish(
      otherId,
      "2026-01-03T00:05:00.000Z",
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

    const funnel = runsDefault.recentFunnel(5);
    expect(funnel).toHaveLength(2);
    expect(funnel.map((r) => r.id)).toEqual([id2, id1]);
    expect(funnel[1].prefilter_rejected).toBe(2);
    expect(funnel[0].had_error).toBe(1);
    expect(funnel[1].had_error).toBe(0);
    expect(funnel.some((r) => r.id === otherId)).toBe(false);
  });

  it("AlertLogRepo.latestAlertedAt returns the newest alert per profile, or null when empty", () => {
    const alertsDefault = new AlertLogRepo(db, "default");
    const alertsOther = new AlertLogRepo(db, "other");
    const result = {
      listing_id: "ebay:abc123",
      score: "YES" as const,
      quality: "pass" as const,
      value: "pass" as const,
      aesthetic: "pass" as const,
      size: "HIGH" as const,
      reason: "Good match",
    };

    expect(alertsDefault.latestAlertedAt()).toBeNull();

    alertsDefault.insert(sampleListing({ id: "1" }), result, "2026-01-01T00:00:00.000Z");
    alertsDefault.insert(sampleListing({ id: "2" }), result, "2026-01-03T00:00:00.000Z");
    alertsDefault.insert(sampleListing({ id: "3" }), result, "2026-01-02T00:00:00.000Z");

    expect(alertsDefault.latestAlertedAt()).toBe("2026-01-03T00:00:00.000Z");
    expect(alertsOther.latestAlertedAt()).toBeNull();
  });
});
