import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/storage/db.js";
import { ScrapeQueriesRepo } from "../../src/storage/repos/scrape-queries.js";
import { RunsRepo } from "../../src/storage/repos/runs.js";
import { AlertLogRepo } from "../../src/storage/repos/alert-log.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";

describe("query scorecard quality fields", () => {
  it("exposes yes_rate, feedback_ratio, and last_good_signal_at", () => {
    const db = openDatabase(":memory:");
    const profileId = "default";
    const ts = "2026-06-01T12:00:00.000Z";
    const queries = new ScrapeQueriesRepo(db, profileId);
    queries.syncFromConfig(
      {
        ...minimalConfig,
        searches: {
          ebay: [{ id: "ebay-quality", q: "test query", status: "active" as const }],
        },
      },
      ts,
    );

    const runId = new RunsRepo(db).start(ts);
    queries.recordQueryRuns(runId, [
      {
        queryId: "ebay-quality",
        platform: "ebay",
        queryText: "test query",
        listingsFound: 10,
        listingsNew: 4,
        scoredYes: 2,
        scoredMaybe: 1,
        scoredNo: 1,
        prefilterRejected: 0,
        alertsSent: 1,
        error: null,
      },
    ]);

    new AlertLogRepo(db, profileId).insert(
      sampleListing({ id: "a1", platform: "ebay", sourceQueryId: "ebay-quality" }),
      {
        listing_id: "ebay:a1",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Good",
      },
      "2026-06-01T13:00:00.000Z",
    );

    new FeedbackRepo(db, profileId).insert(
      {
        platform: "ebay",
        listing_id: "bad1",
        signal: "positive",
        source_query_id: "ebay-quality",
      },
      "2026-06-01T14:00:00.000Z",
    );
    new FeedbackRepo(db, profileId).insert(
      {
        platform: "ebay",
        listing_id: "bad2",
        signal: "negative",
        source_query_id: "ebay-quality",
      },
      "2026-06-01T15:00:00.000Z",
    );

    const row = queries.fetchScorecard().find((r) => r.query_id === "ebay-quality");
    expect(row).toBeDefined();
    expect(row!.scored_yes).toBe(2);
    expect(row!.yes_rate).toBe(0.5);
    expect(row!.alert_rate).toBe(0.25);
    expect(row!.feedback_positive).toBe(1);
    expect(row!.feedback_negative).toBe(1);
    expect(row!.feedback_ratio).toBe(0.5);
    expect(row!.last_alert_at).toBe("2026-06-01T13:00:00.000Z");
    expect(row!.last_good_signal_at).toBe("2026-06-01T14:00:00.000Z");

    db.close();
  });
});
