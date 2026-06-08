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
        description="Per search-group yield with per-platform drill-down."
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
      groupScorecard: data.groupScorecard.filter((g) => g.group_id === focusQueryId),
      queryScorecard: data.queryScorecard.filter((q) => q.group_id === focusQueryId),
      queryRunHistory: data.queryRunHistory.filter(
        (r) => r.query_id === focusQueryId || r.query_id.startsWith(`${focusQueryId}@`),
      ),
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
