import type { Db } from "../storage/db.js";
import type { Config } from "../core/config.js";
import { ScrapeQueriesRepo } from "../storage/repos/scrape-queries.js";
import { ConfigRevisionsRepo, buildConfigSnapshot } from "../storage/repos/config-revisions.js";
import { FeedbackRepo } from "../storage/repos/feedback.js";
import { IntegrationHealthRepo } from "../storage/repos/integration-health.js";

export interface OverviewStats {
  totalRuns: number;
  totalListingsSeen: number;
  totalAlerts: number;
  totalYes: number;
  totalMaybe: number;
  totalNo: number;
  totalPending: number;
  positiveFeedback: number;
  negativeFeedback: number;
  lastRunAt: string | null;
  lastAlertAt: string | null;
}

export interface RunSummaryRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  listings_found: number;
  listings_new: number;
  scored_yes: number;
  scored_maybe: number;
  scored_no: number;
  alerts_sent: number;
  error: string | null;
  had_error: number;
}

export interface ScoreByPlatformRow {
  profile_id: string;
  platform: string;
  score: string;
  listing_count: number;
}

export interface AlertRow {
  id: number;
  platform: string;
  listing_id: string;
  title: string | null;
  brand: string | null;
  price: number | null;
  score: string | null;
  llm_reason: string | null;
  alerted_at: string;
  url: string | null;
  source_query_id: string | null;
}

export interface DailyRunRow {
  run_date: string;
  run_count: number;
  total_found: number;
  total_new: number;
  total_yes: number;
  total_maybe: number;
  total_no: number;
  total_alerts: number;
  error_runs: number;
}

export interface PlatformAlertRow {
  platform: string;
  alerts_sent: number;
  avg_alert_price: number | null;
}

export function fetchOverview(db: Db, profileId: string): OverviewStats {
  const runs = db.prepare(`SELECT COUNT(*) AS n, MAX(started_at) AS last_run FROM runs`).get() as {
    n: number;
    last_run: string | null;
  };

  const seen = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN score = 'YES' THEN 1 ELSE 0 END) AS yes_count,
         SUM(CASE WHEN score = 'MAYBE' THEN 1 ELSE 0 END) AS maybe_count,
         SUM(CASE WHEN score = 'NO' THEN 1 ELSE 0 END) AS no_count,
         SUM(CASE WHEN score = 'PENDING' THEN 1 ELSE 0 END) AS pending_count
       FROM seen_listings WHERE profile_id = ?`,
    )
    .get(profileId) as {
    total: number;
    yes_count: number;
    maybe_count: number;
    no_count: number;
    pending_count: number;
  };

  const alerts = db
    .prepare(
      `SELECT COUNT(*) AS n, MAX(alerted_at) AS last_alert
       FROM alert_log WHERE profile_id = ?`,
    )
    .get(profileId) as { n: number; last_alert: string | null };

  const feedback = db
    .prepare(`SELECT signal, COUNT(*) AS n FROM feedback WHERE profile_id = ? GROUP BY signal`)
    .all(profileId) as Array<{ signal: string; n: number }>;

  const positive = feedback.find((f) => f.signal === "positive")?.n ?? 0;
  const negative = feedback.find((f) => f.signal === "negative")?.n ?? 0;

  return {
    totalRuns: runs.n,
    totalListingsSeen: seen.total,
    totalAlerts: alerts.n,
    totalYes: seen.yes_count,
    totalMaybe: seen.maybe_count,
    totalNo: seen.no_count,
    totalPending: seen.pending_count,
    positiveFeedback: positive,
    negativeFeedback: negative,
    lastRunAt: runs.last_run,
    lastAlertAt: alerts.last_alert,
  };
}

export function fetchRunSummaries(db: Db, limit = 20): RunSummaryRow[] {
  return db
    .prepare(
      `SELECT id, started_at, finished_at, duration_seconds, listings_found, listings_new,
              scored_yes, scored_maybe, scored_no, alerts_sent, error, had_error
       FROM v_run_summary
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit) as RunSummaryRow[];
}

export function fetchScoreByPlatform(db: Db, profileId: string): ScoreByPlatformRow[] {
  return db
    .prepare(
      `SELECT profile_id, platform, score, listing_count
       FROM v_score_by_platform
       WHERE profile_id = ?
       ORDER BY platform, score`,
    )
    .all(profileId) as ScoreByPlatformRow[];
}

export function fetchRecentAlerts(db: Db, profileId: string, limit = 20): AlertRow[] {
  return db
    .prepare(
      `SELECT id, platform, listing_id, title, brand, price, score, llm_reason, alerted_at, url,
              source_query_id
       FROM alert_log
       WHERE profile_id = ?
       ORDER BY alerted_at DESC
       LIMIT ?`,
    )
    .all(profileId, limit) as AlertRow[];
}

export function fetchDailyRuns(db: Db, days = 14): DailyRunRow[] {
  return db
    .prepare(
      `SELECT run_date, run_count, total_found, total_new, total_yes, total_maybe,
              total_no, total_alerts, error_runs
       FROM v_daily_runs
       WHERE run_date >= date('now', ?)
       ORDER BY run_date DESC`,
    )
    .all(`-${days} days`) as DailyRunRow[];
}

export function fetchPlatformAlerts(db: Db, profileId: string): PlatformAlertRow[] {
  return db
    .prepare(
      `SELECT platform, alerts_sent, avg_alert_price
       FROM v_platform_alert_totals
       WHERE profile_id = ?
       ORDER BY alerts_sent DESC`,
    )
    .all(profileId) as PlatformAlertRow[];
}

export function fetchDashboardPayload(db: Db, profileId: string, config: Config) {
  const scrapeQueriesRepo = new ScrapeQueriesRepo(db, profileId);
  const configRevisionsRepo = new ConfigRevisionsRepo(db, profileId);
  const integrationHealthRepo = new IntegrationHealthRepo(db, profileId);
  const feedbackRepo = new FeedbackRepo(db, profileId);

  return {
    overview: fetchOverview(db, profileId),
    runs: fetchRunSummaries(db, 15),
    alerts: fetchRecentAlerts(db, profileId, 15),
    scoresByPlatform: fetchScoreByPlatform(db, profileId),
    dailyRuns: fetchDailyRuns(db, 14),
    platformAlerts: fetchPlatformAlerts(db, profileId),
    queryScorecard: scrapeQueriesRepo.fetchScorecard(),
    queryRunHistory: scrapeQueriesRepo.fetchRunHistory(20),
    integrationUptime: integrationHealthRepo.fetchUptime7d(),
    integrationFailures: integrationHealthRepo.fetchRecentFailures(20),
    configRevisions: configRevisionsRepo.fetchRecent(8).map((row) => ({
      id: row.id,
      recorded_at: row.recorded_at,
      content_hash: row.content_hash.slice(0, 12),
      run_id: row.run_id,
      snapshot: JSON.parse(row.snapshot_json) as ReturnType<typeof buildConfigSnapshot>,
    })),
    promptDiet: {
      aesthetic_prompt: config.aesthetic_prompt,
      hard_no: config.hard_no,
      positive_signals: config.positive_signals,
      positive_examples: feedbackRepo.fetchRecent("positive", 15),
      negative_examples: feedbackRepo.fetchRecent("negative", 15),
    },
    generatedAt: new Date().toISOString(),
  };
}

export type DashboardPayload = ReturnType<typeof fetchDashboardPayload>;
