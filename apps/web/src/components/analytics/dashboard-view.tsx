import type { DashboardPayload } from "@fm/shared/dto.js";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { StatCard } from "@/components/analytics/chart-primitives";
import { DashboardCharts } from "@/components/analytics/dashboard-charts";
import {
  AlertsAndRevisionsSection,
  PromptDietSection,
} from "@/components/analytics/dashboard-sections";

export function DashboardView({ data }: { data: DashboardPayload }) {
  const o = data.overview;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Runs" value={fmtNumber(o.totalRuns)} />
        <StatCard label="Listings seen" value={fmtNumber(o.totalListingsSeen)} />
        <StatCard
          label="Alerts sent"
          value={fmtNumber(o.totalAlerts)}
          hint={o.lastAlertAt ? `Last ${fmtDateTime(o.lastAlertAt)}` : undefined}
        />
        <StatCard label="YES scores" value={fmtNumber(o.totalYes)} />
        <StatCard
          label="Feedback"
          value={`+${fmtNumber(o.positiveFeedback)}`}
          hint={`− ${fmtNumber(o.negativeFeedback)}`}
        />
        <StatCard
          label="Pending"
          value={fmtNumber(o.totalPending)}
          hint={o.lastRunAt ? `Last run ${fmtDateTime(o.lastRunAt)}` : undefined}
        />
      </div>

      <DashboardCharts data={data} />
      <AlertsAndRevisionsSection data={data} />
      <PromptDietSection data={data} />

      <p className="text-right text-xs text-muted-foreground">
        Updated {fmtDateTime(data.generatedAt)}
      </p>
    </div>
  );
}
