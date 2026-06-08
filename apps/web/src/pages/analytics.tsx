import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { DashboardPayload } from "@fm/shared/dto.js";
import { PageHeader, RequireCapability, LoadingPage } from "@/components/common";
import { DashboardView } from "@/components/analytics/dashboard-view";

export function AnalyticsPage() {
  return (
    <RequireCapability capability="analytics:read">
      <PageHeader title="Analytics" description="Pipeline activity, alert yield, and search feedback." />
      <AnalyticsContent />
    </RequireCapability>
  );
}

function AnalyticsContent() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardPayload>("/api/dashboard"),
    refetchInterval: 60_000,
  });

  if (isLoading) return <LoadingPage />;
  if (isError || !data) {
    return <p className="text-sm text-destructive">Failed to load dashboard: {String(error)}</p>;
  }
  return <DashboardView data={data} />;
}
