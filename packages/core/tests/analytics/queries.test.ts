import { describe, expect, it, afterEach } from "vitest";
import { openDatabase } from "../../src/storage/db.js";
import {
  fetchDailyRuns,
  fetchOverview,
  fetchRunSummaries,
  fetchScoreByPlatform,
} from "../../src/analytics/queries.js";
import { formatFullReport } from "../../src/analytics/format-report.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { RunsRepo } from "../../src/storage/repos/runs.js";
import { AlertLogRepo } from "../../src/storage/repos/alert-log.js";
import { ScrapeQueriesRepo } from "../../src/storage/repos/scrape-queries.js";

describe("analytics queries", () => {
  const db = openDatabase(":memory:");
  const profileId = "default";

  afterEach(() => {
    // single shared db per file — tests are ordered additive
  });

  it("reads analytics views after seeding data", () => {
    const started = new Date();
    started.setMinutes(started.getMinutes() - 1);
    const finished = new Date();
    const startedIso = started.toISOString();
    const finishedIso = finished.toISOString();
    const seen = new SeenListingsRepo(db, profileId);
    const runs = new RunsRepo(db);
    const alerts = new AlertLogRepo(db, profileId);

    seen.markSeen(sampleListing({ id: "a1", platform: "ebay" }), "YES", startedIso);
    seen.markSeen(sampleListing({ id: "a2", platform: "depop" }), "NO", startedIso);

    const runId = runs.start(startedIso);
    runs.finish(
      runId,
      finishedIso,
      {
        listingsFound: 10,
        listingsNew: 2,
        scoredYes: 1,
        scoredMaybe: 0,
        scoredNo: 1,
        alertsSent: 1,
        prefilterRejected: 0,
        errors: [],
      },
      null,
    );

    alerts.insert(
      sampleListing({ id: "a1", platform: "ebay" }),
      {
        listing_id: "ebay:a1",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Good corduroy",
      },
      startedIso,
    );

    const overview = fetchOverview(db, profileId);
    expect(overview.totalRuns).toBe(1);
    expect(overview.totalListingsSeen).toBe(2);
    expect(overview.totalAlerts).toBe(1);
    expect(overview.totalYes).toBe(1);

    const runRows = fetchRunSummaries(db, 5);
    expect(runRows[0].duration_seconds).toBeGreaterThanOrEqual(59);
    expect(runRows[0].duration_seconds).toBeLessThanOrEqual(61);
    expect(runRows[0].listings_found).toBe(10);

    const scores = fetchScoreByPlatform(db, profileId);
    expect(scores.some((s) => s.platform === "ebay" && s.score === "YES")).toBe(true);

    const daily = fetchDailyRuns(db, 7);
    expect(daily.length).toBeGreaterThan(0);
    expect(daily[0].total_alerts).toBe(1);

    new ScrapeQueriesRepo(db, profileId).syncFromConfig(minimalConfig, startedIso);
    const scorecard = new ScrapeQueriesRepo(db, profileId).fetchScorecard();
    expect(scorecard.length).toBeGreaterThan(0);
  });

  it("formats a text report", () => {
    const report = formatFullReport({
      overview: fetchOverview(db, profileId),
      runs: fetchRunSummaries(db, 5),
      daily: fetchDailyRuns(db, 7),
      scores: fetchScoreByPlatform(db, profileId),
      platformAlerts: [],
      alerts: [],
    });

    expect(report).toContain("Fashion Monitor — analytics report");
    expect(report).toContain("Runs:");
    expect(report).toContain("Recent runs");
  });
});
