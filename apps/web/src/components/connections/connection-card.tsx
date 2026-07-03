import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import type { ConnectionDto, ConnectionTestResponse } from "@fm/shared/dto.js";
import { apiPost, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import { fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectionStatusBadge } from "./connection-status-badge";

const CONNECTIONS_QUERY_KEY = ["connections"];

export function ConnectionCard({ connection, canWrite }: { connection: ConnectionDto; canWrite: boolean }) {
  const queryClient = useQueryClient();

  const test = useMutation({
    mutationFn: () =>
      apiPost<ConnectionTestResponse>(`/api/connections/${connection.platform}/test`),
    onSuccess: (result) => {
      if (result.ok) toast.success(`${connection.label}: connected`);
      else toast.error(`${connection.label}: ${result.error ?? "test failed"}`);
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
    },
    onError: (e: ApiError) => toastApiError(e, connection.label),
  });

  const disconnect = useMutation({
    mutationFn: () => apiPost(`/api/connections/${connection.platform}/disconnect`),
    onSuccess: () => {
      toast.success(`${connection.label} disconnected`);
      queryClient.invalidateQueries({ queryKey: CONNECTIONS_QUERY_KEY });
    },
    onError: (e: ApiError) => toastApiError(e, connection.label),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            {connection.label}
            {connection.dormant ? <Lock className="size-3.5 text-muted-foreground" /> : null}
          </CardTitle>
          <CardDescription>
            {connection.automatic
              ? "Automatic — no account to connect."
              : connection.dormant
                ? "Login-based connections aren't enabled yet."
                : null}
          </CardDescription>
        </div>
        {connection.automatic ? (
          <Badge variant="secondary">Automatic</Badge>
        ) : connection.dormant ? (
          <Badge variant="outline">Coming later</Badge>
        ) : (
          <ConnectionStatusBadge status={connection.status} />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!connection.automatic && !connection.dormant ? (
          <>
            {connection.lastTestedAt ? (
              <p className="text-xs text-muted-foreground">
                Last tested {fmtDateTime(connection.lastTestedAt)}
                {connection.lastError ? ` — ${connection.lastError}` : ""}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Never tested.</p>
            )}
            {canWrite ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => test.mutate()}
                  disabled={test.isPending || !connection.configured}
                >
                  Test
                </Button>
                {connection.configured ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                  >
                    Disconnect
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!connection.configured ? (
              <p className="text-xs text-muted-foreground">
                Add credentials on the{" "}
                <Link to="/system" search={{ tab: "secrets" }} className="underline">
                  Secrets
                </Link>{" "}
                page to connect.
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
