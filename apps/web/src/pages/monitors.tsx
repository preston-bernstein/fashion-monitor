import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import type { Monitor, MonitorsResponse } from "@fm/shared/dto.js";
import { PageHeader, RequireCapability, LoadingPage } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MonitorDialog } from "@/components/monitors/monitor-dialog";
import { MonitorTable } from "@/components/monitors/monitor-table";

const monitorsRouteApi = getRouteApi("/app/monitors");

export function MonitorsPage() {
  return (
    <RequireCapability capability="monitors:read">
      <MonitorsContent />
    </RequireCapability>
  );
}

function MonitorsContent() {
  const { edit: editId } = monitorsRouteApi.useSearch();
  const navigate = useNavigate({ from: "/monitors" });
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["monitors"],
    queryFn: () => apiGet<MonitorsResponse>("/api/monitors"),
  });

  const [editing, setEditing] = useState<Monitor | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Monitor | null>(null);

  const deepLinkTarget =
    editId && data ? data.monitors.find((m) => m.id === editId) : undefined;
  const activeEdit = editing ?? deepLinkTarget ?? null;
  const highlightId = editId ?? activeEdit?.id;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["monitors"] });

  const toggle = useMutation({
    mutationFn: (m: Monitor) =>
      apiPatch(`/api/monitors/${encodeURIComponent(m.id)}`, {
        enabled: !m.enabled,
        status: !m.enabled ? "active" : "paused",
      }),
    onSuccess: () => {
      toast.success("Monitor updated");
      invalidate();
    },
    onError: (e: ApiError) => toastApiError(e),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/monitors/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success("Monitor deleted");
      setDeleting(null);
      invalidate();
    },
    onError: (e: ApiError) => toastApiError(e),
  });

  if (isLoading || !data) return <LoadingPage />;
  const canWrite = data.canWrite;

  return (
    <>
      <PageHeader
        title="Monitors"
        description="Search queries the pipeline scrapes. Edits take effect on the next scheduled run."
        actions={
          canWrite ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> Add monitor
            </Button>
          ) : undefined
        }
      />

      <MonitorTable
        monitors={data.monitors}
        canWrite={canWrite}
        highlightId={highlightId}
        onEdit={setEditing}
        onToggle={(m) => toggle.mutate(m)}
        onDelete={setDeleting}
      />

      {canWrite ? (
        <>
          <MonitorDialog
            open={creating}
            mode="create"
            onOpenChange={setCreating}
            onSaved={invalidate}
          />
          <MonitorDialog
            open={activeEdit !== null}
            mode="edit"
            monitor={activeEdit ?? undefined}
            onOpenChange={(o) => {
              if (!o) {
                setEditing(null);
                if (editId) void navigate({ search: { edit: undefined }, replace: true });
              }
            }}
            onSaved={() => {
              setEditing(null);
              if (editId) void navigate({ search: { edit: undefined }, replace: true });
              invalidate();
            }}
          />
          <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete monitor</DialogTitle>
                <DialogDescription>
                  Permanently remove <code className="font-mono">{deleting?.id}</code>? The pipeline
                  will stop scraping this query.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleting(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => deleting && remove.mutate(deleting.id)}
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}
