import type { RunFunnelRow } from "../storage/repos/runs.js";

export interface StalenessResult {
  /** True when no successful run finished within `maxHoursSinceSuccess` of `now`. */
  stale: boolean;
  /** ISO timestamp of the most recent run that finished without an error, or null if none exists in the sample. */
  lastSuccessAt: string | null;
  /** Hours between `lastSuccessAt` and `now`, or null when there is no successful run at all. */
  hoursSinceLastSuccess: number | null;
  /** Error text of the most recent run overall (successful or not), for context in the alert. */
  lastRunError: string | null;
  /** ISO timestamp of the most recent run overall (successful or not), or null if `runs` is empty. */
  lastRunAt: string | null;
  /** One-line human-readable summary, suitable as an alert body. */
  summary: string;
}

/**
 * Decides whether the scraper pipeline counts as "dead" — no run has finished
 * successfully (`had_error === 0`, `finished_at` set) within the last
 * `maxHoursSinceSuccess` hours. `runs` must be ordered most-recent-first, the
 * same order `RunsRepo.recentFunnel()` returns (see apps/cli/src/check-scraper-health.ts).
 *
 * An empty `runs` array (no runs ever recorded for this profile) is treated
 * as stale — there is no successful run to point to, which is exactly the
 * silent-death case this check exists to catch.
 */
export function evaluateScraperStaleness(
  runs: RunFunnelRow[],
  now: Date,
  maxHoursSinceSuccess: number,
): StalenessResult {
  const lastRun = runs[0] ?? null;
  const lastSuccess = runs.find((r) => r.had_error === 0 && r.finished_at !== null) ?? null;

  const lastSuccessAt = lastSuccess?.finished_at ?? null;
  const hoursSinceLastSuccess = lastSuccessAt
    ? (now.getTime() - new Date(lastSuccessAt).getTime()) / (1000 * 60 * 60)
    : null;

  const stale = hoursSinceLastSuccess === null || hoursSinceLastSuccess > maxHoursSinceSuccess;

  const lastRunError = lastRun ? errorFromFunnelRow(lastRun) : null;
  const lastRunAt = lastRun?.finished_at ?? lastRun?.started_at ?? null;

  const summary = stale
    ? lastSuccessAt
      ? `No successful scrape run in ${hoursSinceLastSuccess!.toFixed(1)}h (threshold ${maxHoursSinceSuccess}h). Last success: ${lastSuccessAt}. Last attempt: ${lastRunAt ?? "unknown"}${lastRunError ? ` (error: ${lastRunError})` : ""}.`
      : `No successful scrape run has EVER been recorded for this profile. Last attempt: ${lastRunAt ?? "none recorded"}${lastRunError ? ` (error: ${lastRunError})` : ""}.`
    : `Last successful scrape run ${hoursSinceLastSuccess!.toFixed(1)}h ago (within ${maxHoursSinceSuccess}h threshold).`;

  return { stale, lastSuccessAt, hoursSinceLastSuccess, lastRunError, lastRunAt, summary };
}

/**
 * `RunFunnelRow` (the `v_run_summary` view) doesn't carry the raw `error`
 * text column, only `had_error` (0/1) — the view is a rollup, not a passthrough.
 * We only need a best-effort hint for the alert body, so this just reports
 * whether the row failed; callers that need the exact error string should
 * query `runs.error` directly (out of scope for the staleness check itself).
 */
function errorFromFunnelRow(row: RunFunnelRow): string | null {
  return row.had_error ? "run recorded an error (see `runs` table for detail)" : null;
}
