import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ConnectionsResponse, HealthResponse } from "@fm/shared/dto.js";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import { fmtDateTime } from "@/lib/format";
import { useCan } from "@/hooks/use-auth";
import { LoadingPage, PageHeader, RequireCapability } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectionStatusBadge } from "@/components/connections/connection-status-badge";
import { RunFunnelTable } from "@/components/health/run-funnel-table";

export function HealthPage() {
  return (
    <RequireCapability capability="analytics:read">
      <HealthPageContent />
    </RequireCapability>
  );
}

function HealthPageContent() {
  const can = useCan();
  const showConnections = can("secrets:read");
  const queryClient = useQueryClient();

  const health = useQuery({
    queryKey: ["profile-health"],
    queryFn: () => apiGet<HealthResponse>("/api/profile-health"),
  });
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections"),
    enabled: showConnections,
  });

  const testAll = useMutation({
    mutationFn: async () => {
      const active = (connections.data?.connections ?? []).filter(
        (c) => !c.dormant && !c.automatic,
      );
      const results = await Promise.allSettled(
        active.map((c) => apiPost(`/api/connections/${c.platform}/test`)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: active.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      if (total === 0) toast.info("Nothing to test yet.");
      else if (failed === 0) toast.success(`Tested ${total} connection${total === 1 ? "" : "s"}.`);
      else toast.error(`${failed} of ${total} connection tests failed.`);
      queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: ApiError) => toastApiError(e, "Test all"),
  });

  if (health.isLoading || !health.data) return <LoadingPage />;

  return (
    <>
      <PageHeader
        title="Health"
        description="Your monitor flow and uptime — no dashboards to configure, just what happened."
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last alert</CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              {health.data.lastAlertedAt
                ? `You were last alerted ${fmtDateTime(health.data.lastAlertedAt)}.`
                : "No alerts sent yet."}
            </CardDescription>
          </CardContent>
        </Card>

        {showConnections ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Connections</CardTitle>
              {can("secrets:write") ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testAll.mutate()}
                  disabled={testAll.isPending || connections.isLoading}
                >
                  Test all connections
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {connections.isLoading || !connections.data ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {connections.data.connections
                    .filter((c) => !c.dormant)
                    .map((c) => (
                      <div key={c.platform} className="flex items-center gap-2 text-sm">
                        <span>{c.label}</span>
                        <ConnectionStatusBadge status={c.status} />
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        <RunFunnelTable runs={health.data.runs} />
      </div>
    </>
  );
}
