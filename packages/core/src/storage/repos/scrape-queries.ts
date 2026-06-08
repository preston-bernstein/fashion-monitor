import type { Config } from "../../core/config.js";
import { DEFAULT_SEARCHES } from "../../config/searches.js";
import type { Platform } from "../../core/types.js";
import { PLATFORMS } from "../../core/types.js";
import type { Db } from "../db.js";

export interface ScrapeQueryRow {
  id: string;
  profile_id: string;
  platform: Platform;
  query_text: string;
  enabled: number;
  status: string;
  note: string | null;
  updated_at: string;
}

export interface QueryScorecardRow {
  query_id: string;
  platform: string;
  query_text: string;
  status: string;
  note: string | null;
  total_runs: number;
  listings_found: number;
  listings_new: number;
  scored_yes: number;
  alerts_sent: number;
  alert_rate: number | null;
  yes_rate: number | null;
  feedback_positive: number;
  feedback_negative: number;
  feedback_ratio: number | null;
  last_alert_at: string | null;
  last_good_signal_at: string | null;
}

export interface QueryRunStats {
  queryId: string;
  platform: Platform;
  queryText: string;
  listingsFound: number;
  listingsNew: number;
  scoredYes: number;
  scoredMaybe: number;
  scoredNo: number;
  prefilterRejected: number;
  alertsSent: number;
  error: string | null;
}

export class ScrapeQueriesRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  syncFromConfig(config: Config, updatedAt: string): void {
    const upsert = this.db.prepare(
      `INSERT INTO scrape_queries (id, profile_id, platform, query_text, enabled, status, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id, profile_id) DO UPDATE SET
         platform = excluded.platform,
         query_text = excluded.query_text,
         enabled = excluded.enabled,
         status = excluded.status,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    );

    for (const platform of PLATFORMS) {
      const entries = config.searches?.[platform] ?? DEFAULT_SEARCHES[platform];
      for (const entry of entries) {
        upsert.run(
          entry.id,
          this.profileId,
          platform,
          entry.q,
          entry.enabled === false ? 0 : 1,
          entry.status ?? "active",
          entry.note ?? null,
          updatedAt,
        );
      }
    }
  }

  listMonitors(): ScrapeQueryRow[] {
    return this.db
      .prepare(
        `SELECT id, profile_id, platform, query_text, enabled, status, note, updated_at
         FROM scrape_queries WHERE profile_id = ?
         ORDER BY platform, id`,
      )
      .all(this.profileId) as ScrapeQueryRow[];
  }

  getMonitor(id: string): ScrapeQueryRow | undefined {
    return this.db
      .prepare(
        `SELECT id, profile_id, platform, query_text, enabled, status, note, updated_at
         FROM scrape_queries WHERE profile_id = ? AND id = ?`,
      )
      .get(this.profileId, id) as ScrapeQueryRow | undefined;
  }

  createMonitor(
    monitor: {
      id: string;
      platform: Platform;
      query_text: string;
      enabled: boolean;
      status: string;
      note: string | null;
    },
    updatedAt: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO scrape_queries (id, profile_id, platform, query_text, enabled, status, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        monitor.id,
        this.profileId,
        monitor.platform,
        monitor.query_text,
        monitor.enabled ? 1 : 0,
        monitor.status,
        monitor.note,
        updatedAt,
      );
  }

  updateMonitor(
    id: string,
    fields: {
      platform: Platform;
      query_text: string;
      enabled: boolean;
      status: string;
      note: string | null;
    },
    updatedAt: string,
  ): void {
    this.db
      .prepare(
        `UPDATE scrape_queries SET
           platform = ?, query_text = ?, enabled = ?, status = ?, note = ?, updated_at = ?
         WHERE profile_id = ? AND id = ?`,
      )
      .run(
        fields.platform,
        fields.query_text,
        fields.enabled ? 1 : 0,
        fields.status,
        fields.note,
        updatedAt,
        this.profileId,
        id,
      );
  }

  deleteMonitor(id: string): void {
    this.db
      .prepare(`DELETE FROM scrape_queries WHERE profile_id = ? AND id = ?`)
      .run(this.profileId, id);
  }

  recordQueryRuns(runId: number, stats: QueryRunStats[]): void {
    const insert = this.db.prepare(
      `INSERT INTO scrape_query_runs (
         run_id, profile_id, query_id, platform, query_text,
         listings_found, listings_new, scored_yes, scored_maybe, scored_no,
         prefilter_rejected, alerts_sent, error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const row of stats) {
      insert.run(
        runId,
        this.profileId,
        row.queryId,
        row.platform,
        row.queryText,
        row.listingsFound,
        row.listingsNew,
        row.scoredYes,
        row.scoredMaybe,
        row.scoredNo,
        row.prefilterRejected,
        row.alertsSent,
        row.error,
      );
    }
  }

  fetchScorecard(): QueryScorecardRow[] {
    return this.db
      .prepare(
        `SELECT query_id, platform, query_text, status, note, total_runs,
                listings_found, listings_new, scored_yes, alerts_sent,
                alert_rate, yes_rate, feedback_positive, feedback_negative,
                feedback_ratio, last_alert_at, last_good_signal_at
         FROM v_query_scorecard
         WHERE profile_id = ?
         ORDER BY alerts_sent DESC, listings_new DESC`,
      )
      .all(this.profileId) as QueryScorecardRow[];
  }

  fetchRunHistory(limit = 30): Array<{
    run_started_at: string;
    platform: string;
    query_id: string;
    query_text: string;
    listings_found: number;
    listings_new: number;
    alerts_sent: number;
    error: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT run_started_at, platform, query_id, query_text,
                listings_found, listings_new, alerts_sent, error
         FROM v_query_run_history
         WHERE profile_id = ?
         LIMIT ?`,
      )
      .all(this.profileId, limit) as Array<{
      run_started_at: string;
      platform: string;
      query_id: string;
      query_text: string;
      listings_found: number;
      listings_new: number;
      alerts_sent: number;
      error: string | null;
    }>;
  }
}
