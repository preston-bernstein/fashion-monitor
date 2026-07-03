import type { RunStats } from "../../core/types.js";
import type { Db } from "../db.js";
import { pruneOlderThan as pruneRowsOlderThan } from "../prune.js";

export interface RunRecord {
  id: number;
  profile_id: string;
  started_at: string;
  finished_at: string | null;
  listings_found: number;
  listings_new: number;
  scored_yes: number;
  scored_maybe: number;
  scored_no: number;
  alerts_sent: number;
  error: string | null;
}

export interface RunFunnelRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  listings_found: number;
  listings_new: number;
  prefilter_rejected: number;
  scored_yes: number;
  scored_maybe: number;
  scored_no: number;
  alerts_sent: number;
  had_error: number;
}

export class RunsRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  start(startedAt: string): number {
    const result = this.db
      .prepare(`INSERT INTO runs (profile_id, started_at) VALUES (?, ?)`)
      .run(this.profileId, startedAt);
    return Number(result.lastInsertRowid);
  }

  finish(runId: number, finishedAt: string, stats: RunStats, error: string | null): void {
    this.db
      .prepare(
        `UPDATE runs SET
          finished_at = ?,
          listings_found = ?,
          listings_new = ?,
          prefilter_rejected = ?,
          scored_yes = ?,
          scored_maybe = ?,
          scored_no = ?,
          alerts_sent = ?,
          error = ?
         WHERE id = ? AND profile_id = ?`,
      )
      .run(
        finishedAt,
        stats.listingsFound,
        stats.listingsNew,
        stats.prefilterRejected,
        stats.scoredYes,
        stats.scoredMaybe,
        stats.scoredNo,
        stats.alertsSent,
        error,
        runId,
        this.profileId,
      );
  }

  pruneOlderThan(days: number, now: Date): number {
    return pruneRowsOlderThan(
      this.db,
      `DELETE FROM runs WHERE started_at < ? AND profile_id = ?`,
      [this.profileId],
      days,
      now,
    );
  }

  recentFunnel(limit = 5): RunFunnelRow[] {
    return this.db
      .prepare(
        `SELECT id, started_at, finished_at, duration_seconds,
                listings_found, listings_new, prefilter_rejected,
                scored_yes, scored_maybe, scored_no, alerts_sent, had_error
         FROM v_run_summary
         WHERE profile_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(this.profileId, limit) as RunFunnelRow[];
  }
}
