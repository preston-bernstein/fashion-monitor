import { useQuery } from "@tanstack/react-query";
import type { ConnectionsResponse } from "@fm/shared/dto.js";
import { apiGet } from "@/lib/api";
import { useCan } from "@/hooks/use-auth";
import { LoadingPage, PageHeader, RequireCapability } from "@/components/common";
import { ConnectionCard } from "@/components/connections/connection-card";

export function ConnectionsPage() {
  return (
    <RequireCapability capability="secrets:read">
      <ConnectionsPageContent />
    </RequireCapability>
  );
}

function ConnectionsPageContent() {
  const can = useCan();
  const { data, isLoading } = useQuery({
    queryKey: ["connections"],
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections"),
  });

  if (isLoading || !data) return <LoadingPage />;

  const active = data.connections.filter((c) => !c.dormant);
  const dormant = data.connections.filter((c) => c.dormant);

  return (
    <>
      <PageHeader
        title="Connections"
        description="Platform accounts and the alert destination this profile uses. Test to confirm a connection works; Disconnect to remove stored credentials."
      />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((connection) => (
            <ConnectionCard
              key={connection.platform}
              connection={connection}
              canWrite={can("secrets:write")}
            />
          ))}
        </div>
        {dormant.length > 0 ? (
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Not yet available — login-based connections are disabled pending ToS review
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {dormant.map((connection) => (
                <ConnectionCard
                  key={connection.platform}
                  connection={connection}
                  canWrite={can("secrets:write")}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
