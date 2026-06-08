import type { DashboardPayload, QueryScorecardRow } from "@fm/shared/dto.js";
import { Link } from "@tanstack/react-router";
import { fmtDateTime, fmtPrice } from "@/lib/format";
import {
  overallQueryQuality,
  QUALITY_TOOLTIP,
} from "@/lib/query-quality";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimpleTable } from "@/components/analytics/chart-primitives";
import { cn } from "@/lib/utils";

function qualityClass(level: ReturnType<typeof overallQueryQuality>): string {
  if (level === "good") return "text-emerald-600 dark:text-emerald-400";
  if (level === "borderline") return "text-amber-600 dark:text-amber-400";
  if (level === "poor") return "text-destructive";
  return "text-muted-foreground";
}

function formatRate(rate: number | null): string {
  if (rate == null) return "—";
  return `${Math.round(rate * 1000) / 10}%`;
}

function QueryQualityCell({ row }: { row: QueryScorecardRow }) {
  const level = overallQueryQuality(row);
  return (
    <span className={cn("font-medium", qualityClass(level))} title={QUALITY_TOOLTIP}>
      {level === "unknown" ? "—" : level}
    </span>
  );
}

export function IntegrationHealthSection({ data }: { data: DashboardPayload }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integration uptime (7d)</CardTitle>
          <CardDescription>Scrapers, LLM, and alert delivery health</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleTable
            head={["Integration", "Uptime", "OK", "Deg", "Fail"]}
            rows={data.integrationUptime.map((r) => [
              <code key="i" className="font-mono text-xs">
                {r.integration}
              </code>,
              r.uptime_pct != null ? `${r.uptime_pct}%` : "—",
              r.ok_count,
              r.degraded_count,
              r.fail_count,
            ])}
            empty="No integration events recorded yet."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent integration failures</CardTitle>
          <CardDescription>Latest degraded / failed operations</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleTable
            head={["When", "Integration", "Operation", "Error"]}
            rows={data.integrationFailures.map((r) => [
              fmtDateTime(r.recorded_at),
              <code key="i" className="font-mono text-xs">
                {r.integration}
              </code>,
              r.operation,
              <span key="e" className="text-muted-foreground">
                {r.error ?? ""}
              </span>,
            ])}
            empty="No recent failures."
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function QueryRunHistorySection({ data }: { data: DashboardPayload }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Query run history</CardTitle>
        <CardDescription>Recent per-query pipeline results</CardDescription>
      </CardHeader>
      <CardContent>
        <SimpleTable
          head={["Run time", "Platform", "Query", "Found", "New", "Alerts", "Error"]}
          rows={data.queryRunHistory.map((r) => [
            fmtDateTime(r.run_started_at),
            r.platform,
            <div key="q">
              <code className="font-mono text-xs">{r.query_id}</code>
              <div className="text-xs text-muted-foreground">{r.query_text}</div>
            </div>,
            r.listings_found,
            r.listings_new,
            r.alerts_sent,
            <span key="e" className="text-muted-foreground">
              {r.error ?? ""}
            </span>,
          ])}
          empty="No query runs yet."
        />
      </CardContent>
    </Card>
  );
}

export function QueryScorecardSection({ data }: { data: DashboardPayload }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Search scorecard</CardTitle>
        <CardDescription title={QUALITY_TOOLTIP}>
          Per-query yield and curator quality signals across all runs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SimpleTable
          head={[
            "Platform",
            "Query",
            "Status",
            "Runs",
            "New",
            "YES",
            "Alerts",
            "Alert rate",
            "Feedback",
            "Last signal",
            "Quality",
          ]}
          rows={data.queryScorecard.map((q) => [
            q.platform,
            <div key="q">
              <Link
                to="/query-performance"
                search={{ query: q.query_id }}
                className="font-mono text-xs underline underline-offset-2"
              >
                {q.query_id}
              </Link>
              <div className="text-xs text-muted-foreground">{q.query_text}</div>
            </div>,
            q.status,
            q.total_runs,
            q.listings_new,
            q.scored_yes,
            q.alerts_sent,
            formatRate(q.alert_rate),
            `${q.feedback_positive}/${q.feedback_negative}${q.feedback_ratio != null ? ` (${formatRate(q.feedback_ratio)})` : ""}`,
            q.last_good_signal_at ? fmtDateTime(q.last_good_signal_at) : "—",
            <QueryQualityCell key="quality" row={q} />,
          ])}
          empty="No query runs yet."
        />
      </CardContent>
    </Card>
  );
}

export function AlertsAndRevisionsSection({ data }: { data: DashboardPayload }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent alerts</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleTable
            head={["When", "Platform", "Query", "Price", "Title", "Score"]}
            rows={data.alerts.map((a) => [
              fmtDateTime(a.alerted_at),
              a.platform,
              a.source_query_id ? (
                <Link
                  key="q"
                  to="/query-performance"
                  search={{ query: a.source_query_id }}
                  className="font-mono text-xs underline underline-offset-2"
                >
                  {a.source_query_id}
                </Link>
              ) : (
                "—"
              ),
              fmtPrice(a.price),
              a.url ? (
                <a
                  key="t"
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {a.title || a.listing_id}
                </a>
              ) : (
                a.title || a.listing_id
              ),
              a.score ? <Badge variant="outline">{a.score}</Badge> : "",
            ])}
            empty="No alerts yet."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Config revisions</CardTitle>
          <CardDescription>Snapshots written on each config change</CardDescription>
        </CardHeader>
        <CardContent>
          <SimpleTable
            head={["When", "Hash", "Run"]}
            rows={data.configRevisions.map((r) => [
              fmtDateTime(r.recorded_at),
              <code key="h" className="font-mono text-xs">
                {r.content_hash}
              </code>,
              r.run_id ?? "",
            ])}
            empty="No revisions yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function PromptDietSection({ data }: { data: DashboardPayload }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prompt diet (few-shot)</CardTitle>
        <CardDescription>
          Static aesthetic + signals plus the most recent positive/negative examples.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {data.promptDiet.positive_examples.map((f, i) => (
            <Badge key={`p${i}`} variant="success">
              + {f.title || f.listing_id}
            </Badge>
          ))}
          {data.promptDiet.negative_examples.map((f, i) => (
            <span key={`n${i}`} className="inline-flex items-center gap-1">
              <Badge variant="destructive">− {f.title || f.listing_id}</Badge>
              {f.source_query_id ? (
                <Link
                  to="/monitors"
                  search={{ edit: f.source_query_id }}
                  className="text-xs underline underline-offset-2"
                >
                  Revise query
                </Link>
              ) : null}
            </span>
          ))}
          {data.promptDiet.positive_examples.length === 0 &&
          data.promptDiet.negative_examples.length === 0 ? (
            <span className="text-sm text-muted-foreground">No feedback recorded yet.</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
