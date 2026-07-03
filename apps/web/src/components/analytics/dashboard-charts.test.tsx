import { describe, expect, it } from "vitest";
import { computeDailyData, computeScoreData } from "./dashboard-charts";

describe("computeDailyData", () => {
  it("reverses newest-first input to oldest-first and slices an MM-DD label", () => {
    const result = computeDailyData([
      { run_date: "2026-01-03", run_count: 2, total_found: 10, total_new: 3, total_yes: 1, total_alerts: 1 },
      { run_date: "2026-01-02", run_count: 1, total_found: 5, total_new: 2, total_yes: 0, total_alerts: 0 },
      { run_date: "2026-01-01", run_count: 1, total_found: 4, total_new: 4, total_yes: 2, total_alerts: 1 },
    ]);

    expect(result.map((d) => d.run_date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(result.map((d) => d.label)).toEqual(["01-01", "01-02", "01-03"]);
    expect(result[0]).toMatchObject({ total_found: 4, total_new: 4 });
  });

  it("returns an empty array for no runs", () => {
    expect(computeDailyData([])).toEqual([]);
  });
});

describe("computeScoreData", () => {
  it("pivots long-format platform/score rows into one object per platform", () => {
    const result = computeScoreData([
      { platform: "ebay", score: "YES", listing_count: 5 },
      { platform: "ebay", score: "NO", listing_count: 12 },
      { platform: "grailed", score: "MAYBE", listing_count: 3 },
    ]);

    expect(result).toEqual([
      { platform: "ebay", YES: 5, NO: 12 },
      { platform: "grailed", MAYBE: 3 },
    ]);
  });

  it("returns an empty array for no scores", () => {
    expect(computeScoreData([])).toEqual([]);
  });

  it("preserves first-seen platform order", () => {
    const result = computeScoreData([
      { platform: "poshmark", score: "YES", listing_count: 1 },
      { platform: "ebay", score: "YES", listing_count: 2 },
      { platform: "poshmark", score: "NO", listing_count: 1 },
    ]);

    expect(result.map((r) => r.platform)).toEqual(["poshmark", "ebay"]);
  });
});
