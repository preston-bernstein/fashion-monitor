import { describe, expect, it } from "vitest";
import { evaluateScraperStaleness } from "../../src/analytics/staleness.js";
import type { RunFunnelRow } from "../../src/storage/repos/runs.js";

const NOW = new Date("2026-08-02T12:00:00Z");

function row(overrides: Partial<RunFunnelRow>): RunFunnelRow {
  return {
    id: 1,
    started_at: "2026-08-01T00:00:00Z",
    finished_at: "2026-08-01T00:05:00Z",
    duration_seconds: 300,
    listings_found: 10,
    listings_new: 2,
    prefilter_rejected: 3,
    scored_yes: 1,
    scored_maybe: 1,
    scored_no: 0,
    alerts_sent: 1,
    had_error: 0,
    ...overrides,
  };
}

describe("evaluateScraperStaleness", () => {
  it("is not stale when the most recent run succeeded within the threshold", () => {
    const runs = [row({ finished_at: "2026-08-02T10:00:00Z", had_error: 0 })];
    const result = evaluateScraperStaleness(runs, NOW, 48);
    expect(result.stale).toBe(false);
    expect(result.hoursSinceLastSuccess).toBeCloseTo(2, 1);
    expect(result.lastSuccessAt).toBe("2026-08-02T10:00:00Z");
  });

  it("is stale when the last success is older than the threshold", () => {
    // 12 days old, well past a 48h threshold — this is the exact fashion-monitor
    // incident this check exists to catch (scraper dead 12 days, silently).
    const runs = [row({ finished_at: "2026-07-21T12:00:00Z", had_error: 0 })];
    const result = evaluateScraperStaleness(runs, NOW, 48);
    expect(result.stale).toBe(true);
    expect(result.hoursSinceLastSuccess).toBeGreaterThan(48);
    expect(result.summary).toContain("No successful scrape run in");
  });

  it("is stale when there are no runs at all", () => {
    const result = evaluateScraperStaleness([], NOW, 48);
    expect(result.stale).toBe(true);
    expect(result.lastSuccessAt).toBeNull();
    expect(result.hoursSinceLastSuccess).toBeNull();
    expect(result.summary).toContain("No successful scrape run has EVER been recorded");
  });

  it("is stale when every recorded run errored, even if recent", () => {
    const runs = [
      row({ finished_at: "2026-08-02T11:00:00Z", had_error: 1 }),
      row({ finished_at: "2026-08-01T11:00:00Z", had_error: 1 }),
    ];
    const result = evaluateScraperStaleness(runs, NOW, 48);
    expect(result.stale).toBe(true);
    expect(result.lastSuccessAt).toBeNull();
    expect(result.lastRunAt).toBe("2026-08-02T11:00:00Z");
    expect(result.lastRunError).toContain("error");
  });

  it("finds the most recent success even when a later run failed", () => {
    const runs = [
      row({ id: 2, finished_at: "2026-08-02T09:00:00Z", had_error: 1 }),
      row({ id: 1, finished_at: "2026-08-02T06:00:00Z", had_error: 0 }),
    ];
    const result = evaluateScraperStaleness(runs, NOW, 48);
    expect(result.stale).toBe(false);
    expect(result.lastSuccessAt).toBe("2026-08-02T06:00:00Z");
    // lastRunAt/lastRunError describe the most recent run overall (the failed one),
    // not the most recent success — that distinction is part of the alert's value.
    expect(result.lastRunAt).toBe("2026-08-02T09:00:00Z");
    expect(result.lastRunError).toContain("error");
  });

  it("treats an unfinished (in-progress) run as not a success", () => {
    const runs = [row({ finished_at: null, had_error: 0 })];
    const result = evaluateScraperStaleness(runs, NOW, 48);
    expect(result.stale).toBe(true);
    expect(result.lastSuccessAt).toBeNull();
  });
});
