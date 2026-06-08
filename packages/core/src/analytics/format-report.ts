import type {
  AlertRow,
  DailyRunRow,
  OverviewStats,
  PlatformAlertRow,
  RunSummaryRow,
  ScoreByPlatformRow,
} from "./queries.js";

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatOverview(stats: OverviewStats): string {
  const lines = [
    "Overview",
    "────────",
    `Runs:              ${stats.totalRuns}`,
    `Listings seen:     ${stats.totalListingsSeen}`,
    `Alerts sent:       ${stats.totalAlerts}`,
    `Scores YES/MAYBE/NO/PENDING: ${stats.totalYes} / ${stats.totalMaybe} / ${stats.totalNo} / ${stats.totalPending}`,
    `Feedback +/−:      ${stats.positiveFeedback} / ${stats.negativeFeedback}`,
    `Last run:          ${fmtTime(stats.lastRunAt)}`,
    `Last alert:        ${fmtTime(stats.lastAlertAt)}`,
  ];
  return lines.join("\n");
}

export function formatRunsTable(runs: RunSummaryRow[]): string {
  if (runs.length === 0) return "Recent runs\n───────────\n(no runs yet)";

  const header = [
    pad("Started", 19),
    pad("Found", 6),
    pad("New", 5),
    pad("YES", 5),
    pad("Alert", 6),
    pad("Dur", 7),
    "Error",
  ].join(" ");

  const rows = runs.map((r) =>
    [
      pad(fmtTime(r.started_at), 19),
      pad(String(r.listings_found), 6),
      pad(String(r.listings_new), 5),
      pad(String(r.scored_yes), 5),
      pad(String(r.alerts_sent), 6),
      pad(fmtDuration(r.duration_seconds), 7),
      r.error ? "yes" : "",
    ].join(" "),
  );

  return ["Recent runs", "───────────", header, ...rows].join("\n");
}

export function formatDailyRuns(daily: DailyRunRow[]): string {
  if (daily.length === 0) return "Daily activity (14d)\n──────────────────\n(no data)";

  const header = [
    pad("Date", 12),
    pad("Runs", 5),
    pad("Found", 7),
    pad("New", 5),
    pad("YES", 5),
    pad("Alerts", 7),
  ].join(" ");

  const rows = daily.map((d) =>
    [
      pad(d.run_date, 12),
      pad(String(d.run_count), 5),
      pad(String(d.total_found), 7),
      pad(String(d.total_new), 5),
      pad(String(d.total_yes), 5),
      pad(String(d.total_alerts), 7),
    ].join(" "),
  );

  return ["Daily activity (14d)", "──────────────────", header, ...rows].join("\n");
}

export function formatScoreByPlatform(rows: ScoreByPlatformRow[]): string {
  if (rows.length === 0) return "Scores by platform\n──────────────────\n(no data)";

  const grouped = new Map<string, Array<{ score: string; count: number }>>();
  for (const row of rows) {
    const list = grouped.get(row.platform) ?? [];
    list.push({ score: row.score, count: row.listing_count });
    grouped.set(row.platform, list);
  }

  const lines = ["Scores by platform", "──────────────────"];
  for (const [platform, scores] of grouped) {
    const parts = scores.map((s) => `${s.score}:${s.count}`).join(", ");
    lines.push(`${pad(platform, 12)} ${parts}`);
  }
  return lines.join("\n");
}

export function formatPlatformAlerts(rows: PlatformAlertRow[]): string {
  if (rows.length === 0) return "Alerts by platform\n──────────────────\n(no alerts)";

  const lines = ["Alerts by platform", "──────────────────"];
  for (const row of rows) {
    const avg = row.avg_alert_price != null ? `$${row.avg_alert_price}` : "—";
    lines.push(`${pad(row.platform, 12)} ${row.alerts_sent} alerts (avg ${avg})`);
  }
  return lines.join("\n");
}

export function formatQueryScorecard(
  rows: Array<{
    platform: string;
    query_id: string;
    query_text: string;
    status: string;
    note: string | null;
    total_runs: number;
    listings_new: number;
    alerts_sent: number;
    feedback_positive: number;
    feedback_negative: number;
  }>,
): string {
  if (rows.length === 0) return "Search scorecard\n───────────────\n(no queries synced yet)";

  const lines = ["Search scorecard", "───────────────"];
  for (const row of rows) {
    const flag = row.status === "needs_revision" ? " [revise]" : "";
    const note = row.note ? ` — ${row.note}` : "";
    lines.push(
      `${pad(row.platform, 10)} ${row.query_id}${flag}`,
      `  "${row.query_text.slice(0, 60)}${row.query_text.length > 60 ? "…" : ""}"${note}`,
      `  runs ${row.total_runs} · new ${row.listings_new} · alerts ${row.alerts_sent} · +${row.feedback_positive}/−${row.feedback_negative}`,
    );
  }
  return lines.join("\n");
}

export function formatIntegrationUptime(
  rows: Array<{
    integration: string;
    event_count: number;
    ok_count: number;
    degraded_count: number;
    fail_count: number;
    uptime_pct: number | null;
    last_ok_at: string | null;
    last_problem_at: string | null;
  }>,
): string {
  if (rows.length === 0) return "Integration uptime (7d)\n─────────────────────\n(no events yet)";

  const lines = ["Integration uptime (7d)", "─────────────────────"];
  for (const row of rows) {
    const pct = row.uptime_pct != null ? `${row.uptime_pct}%` : "—";
    const problems = row.degraded_count + row.fail_count;
    lines.push(
      `${pad(row.integration, 28)} ${pct} ok  (${row.ok_count}/${row.event_count} checks, ${problems} problems)`,
    );
    if (row.last_problem_at) {
      lines.push(`  last problem: ${fmtTime(row.last_problem_at)}`);
    }
  }
  return lines.join("\n");
}

export function formatIntegrationFailures(
  rows: Array<{
    integration: string;
    operation: string;
    status: string;
    error: string | null;
    recorded_at: string;
    run_id: number | null;
  }>,
): string {
  if (rows.length === 0)
    return "Recent integration failures\n───────────────────────────\n(none in log)";

  const lines = ["Recent integration failures", "───────────────────────────"];
  for (const row of rows.slice(0, 15)) {
    const err = row.error ? ` — ${row.error.slice(0, 80)}` : "";
    lines.push(
      `${fmtTime(row.recorded_at)}  ${row.integration}  ${row.operation}  [${row.status}]${err}`,
    );
  }
  return lines.join("\n");
}

export function formatRecentAlerts(alerts: AlertRow[]): string {
  if (alerts.length === 0) return "Recent alerts\n─────────────\n(none)";

  const lines = ["Recent alerts", "─────────────"];
  for (const a of alerts.slice(0, 10)) {
    const price = a.price != null ? `$${a.price}` : "—";
    lines.push(`${fmtTime(a.alerted_at)}  ${a.platform}  ${price}  ${a.title ?? a.listing_id}`);
  }
  return lines.join("\n");
}

export function formatFullReport(parts: {
  overview: OverviewStats;
  runs: RunSummaryRow[];
  daily: DailyRunRow[];
  scores: ScoreByPlatformRow[];
  platformAlerts: PlatformAlertRow[];
  alerts: AlertRow[];
  queryScorecard?: string;
  integrationUptime?: string;
  integrationFailures?: string;
  configRevisions?: Array<{ recorded_at: string; content_hash: string }>;
}): string {
  const revisionLines =
    parts.configRevisions && parts.configRevisions.length > 0
      ? [
          "Config revisions",
          "────────────────",
          ...parts.configRevisions.map(
            (r) => `${fmtTime(r.recorded_at)}  hash ${r.content_hash.slice(0, 12)}…`,
          ),
          "",
        ].join("\n")
      : "";

  return [
    "Fashion Monitor — analytics report",
    "================================",
    "",
    formatOverview(parts.overview),
    "",
    parts.queryScorecard ? `${parts.queryScorecard}\n` : "",
    parts.integrationUptime ? `${parts.integrationUptime}\n` : "",
    parts.integrationFailures ? `${parts.integrationFailures}\n` : "",
    revisionLines,
    formatDailyRuns(parts.daily),
    "",
    formatRunsTable(parts.runs),
    "",
    formatScoreByPlatform(parts.scores),
    "",
    formatPlatformAlerts(parts.platformAlerts),
    "",
    formatRecentAlerts(parts.alerts),
    "",
  ].join("\n");
}
