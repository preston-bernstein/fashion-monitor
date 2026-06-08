import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { apiGet } from "@/lib/api";
import type { DashboardPayload } from "@fm/shared/dto.js";
import { PageHeader, RequireCapability, LoadingPage } from "@/components/common";
import {
  QueryRunHistorySection,
  QueryScorecardSection,
} from "@/components/analytics/dashboard-sections";

const queryPerformanceRouteApi = getRouteApi("/app/query-performance");

export function QueryPerformancePage() {
  return (
    <RequireCapability capability="analytics:read">
      <PageHeader
        title="Query performance"
        description="Per-search yield, quality signals, and recent run history across platforms."
      />
      <QueryPerformanceContent />
    </RequireCapability>
  );
}

function QueryPerformanceContent() {
  const { query: focusQueryId } = queryPerformanceRouteApi.useSearch();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardPayload>("/api/dashboard"),
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    if (!data || !focusQueryId) return data;
    return {
      ...data,
      queryScorecard: data.queryScorecard.filter((q) => q.query_id === focusQueryId),
      queryRunHistory: data.queryRunHistory.filter((r) => r.query_id === focusQueryId),
    };
  }, [data, focusQueryId]);

  if (isLoading) return <LoadingPage />;
  if (isError || !data || !filtered) {
    return (
      <p className="text-sm text-destructive">Failed to load query performance: {String(error)}</p>
    );
  }

  return (
    <div className="space-y-6">
      {focusQueryId ? (
        <p className="text-sm text-muted-foreground">
          Filtered to query <code className="font-mono">{focusQueryId}</code>
        </p>
      ) : null}
      <QueryScorecardSection data={filtered} />
      <QueryRunHistorySection data={filtered} />
    </div>
  );
}
