import type { Db } from "../db.js";
import { pruneOlderThan as pruneRowsOlderThan } from "../prune.js";

export type IntegrationStatus = "ok" | "degraded" | "fail";

export interface IntegrationEventInput {
  integration: string;
  operation: string;
  status: IntegrationStatus;
  error?: string | null;
  durationMs?: number | null;
  runId?: number | null;
  recordedAt: string;
}

export interface IntegrationUptimeRow {
  integration: string;
  event_count: number;
  ok_count: number;
  degraded_count: number;
  fail_count: number;
  uptime_pct: number | null;
  last_ok_at: string | null;
  last_problem_at: string | null;
}

export interface IntegrationFailureRow {
  id: number;
  integration: string;
  operation: string;
  status: string;
  error: string | null;
  duration_ms: number | null;
  recorded_at: string;
  run_id: number | null;
}

export class IntegrationHealthRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  record(event: IntegrationEventInput): void {
    this.db
      .prepare(
        `INSERT INTO integration_events (
           profile_id, run_id, integration, operation, status, error, duration_ms, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.profileId,
        event.runId ?? null,
        event.integration,
        event.operation,
        event.status,
        event.error ?? null,
        event.durationMs ?? null,
        event.recordedAt,
      );
  }

  pruneOlderThan(days: number, now: Date): number {
    return pruneRowsOlderThan(
      this.db,
      `DELETE FROM integration_events WHERE recorded_at < ? AND profile_id = ?`,
      [this.profileId],
      days,
      now,
    );
  }

  fetchUptime7d(): IntegrationUptimeRow[] {
    return this.db
      .prepare(
        `SELECT integration, event_count, ok_count, degraded_count, fail_count,
                uptime_pct, last_ok_at, last_problem_at
         FROM v_integration_uptime_7d
         WHERE profile_id = ?
         ORDER BY fail_count DESC, degraded_count DESC, integration`,
      )
      .all(this.profileId) as IntegrationUptimeRow[];
  }

  fetchRecentFailures(limit = 25): IntegrationFailureRow[] {
    return this.db
      .prepare(
        `SELECT id, integration, operation, status, error, duration_ms, recorded_at, run_id
         FROM v_integration_recent_failures
         WHERE profile_id = ?
         LIMIT ?`,
      )
      .all(this.profileId, limit) as IntegrationFailureRow[];
  }
}
