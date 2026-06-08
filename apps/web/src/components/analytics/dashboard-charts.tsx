import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardPayload } from "@fm/shared/dto.js";
import {
  ChartCard,
  EmptyChart,
  tooltipStyle,
} from "@/components/analytics/chart-primitives";

const SCORE_KEYS = ["YES", "MAYBE", "NO", "PENDING"] as const;
const SCORE_COLOR: Record<string, string> = {
  YES: "var(--chart-2)",
  MAYBE: "var(--chart-4)",
  NO: "var(--chart-5)",
  PENDING: "var(--chart-3)",
};

export function DashboardCharts({ data }: { data: DashboardPayload }) {
  const dailyData = useMemo(
    () => [...data.dailyRuns].reverse().map((d) => ({ ...d, label: d.run_date.slice(5) })),
    [data.dailyRuns],
  );

  const scoreData = useMemo(() => {
    const byPlatform = new Map<string, Record<string, number | string>>();
    for (const row of data.scoresByPlatform) {
      const entry = byPlatform.get(row.platform) ?? { platform: row.platform };
      entry[row.score] = row.listing_count;
      byPlatform.set(row.platform, entry);
    }
    return [...byPlatform.values()];
  }, [data.scoresByPlatform]);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Daily activity" description="Listings found vs. new over the last 14 days">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={dailyData} margin={{ left: -16, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="found" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="newg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="total_found"
                name="Found"
                stroke="var(--chart-1)"
                fill="url(#found)"
              />
              <Area
                type="monotone"
                dataKey="total_new"
                name="New"
                stroke="var(--chart-2)"
                fill="url(#newg)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Alerts by platform" description="Total alerts delivered per marketplace">
          {data.platformAlerts.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.platformAlerts} margin={{ left: -16, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="platform" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  allowDecimals={false}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                <Bar dataKey="alerts_sent" name="Alerts" radius={[4, 4, 0, 0]}>
                  {data.platformAlerts.map((_, i) => (
                    <Cell key={i} fill="var(--chart-1)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Scores by platform" description="Verdict distribution across marketplaces">
        {scoreData.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={scoreData} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="platform" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
                allowDecimals={false}
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
              {SCORE_KEYS.map((key) => (
                <Bar key={key} dataKey={key} stackId="s" fill={SCORE_COLOR[key]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </>
  );
}
