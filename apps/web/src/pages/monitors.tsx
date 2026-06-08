import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiPatch, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import type { SearchGroup } from "@fm/shared/dto.js";
import { fetchMonitors, MONITORS_QUERY_KEY } from "@/lib/monitors-query";
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: MONITORS_QUERY_KEY,
    queryFn: fetchMonitors,
    staleTime: 30_000,
  });

  const [editingGroup, setEditingGroup] = useState<SearchGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<SearchGroup | null>(null);

  const deepLinkGroup =
    editId && data ? data.groups.find((g) => g.id === editId) : undefined;
  const activeEditGroup = editingGroup ?? deepLinkGroup ?? null;
  const highlightId = editId ?? activeEditGroup?.id;

  const defaultPlatforms = useMemo(() => {
    if (!data) return undefined;
    return data.platforms.filter((p) => p !== "vinted");
  }, [data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: MONITORS_QUERY_KEY });

  const toggleGroup = useMutation({
    mutationFn: (g: SearchGroup) =>
      apiPatch(`/api/monitors/${encodeURIComponent(g.id)}`, {
        enabled: !g.enabled,
        status: !g.enabled ? "active" : "paused",
      }),
    onSuccess: () => {
      toast.success("Search group updated");
      invalidate();
    },
    onError: (e: ApiError) => toastApiError(e),
  });

  const removeGroup = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/monitors/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success("Search group deleted");
      setDeletingGroup(null);
      invalidate();
    },
    onError: (e: ApiError) => toastApiError(e),
  });

  const canWrite = data?.canWrite ?? false;

  return (
    <>
      <PageHeader
        title="Monitors"
        description="Search groups fan out to multiple platforms. Edits take effect on the next scheduled run."
        actions={
          canWrite ? (
            <Button onClick={() => setCreating(true)} disabled={isLoading}>
              <Plus className="size-4" /> Add search group
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <LoadingPage />
      ) : isError || !data ? (
        <p className="text-sm text-destructive">Failed to load monitors: {String(error)}</p>
      ) : (
        <MonitorTable
          groups={data.groups}
          canWrite={canWrite}
          highlightId={highlightId}
          onEditGroup={setEditingGroup}
          onToggleGroup={(g) => toggleGroup.mutate(g)}
          onDeleteGroup={setDeletingGroup}
        />
      )}

      {canWrite && data ? (
        <>
          <MonitorDialog
            open={creating}
            mode="create"
            defaultPlatforms={defaultPlatforms}
            onOpenChange={setCreating}
            onSaved={invalidate}
          />
          <MonitorDialog
            open={activeEditGroup !== null}
            mode="edit"
            group={activeEditGroup ?? undefined}
            onOpenChange={(o) => {
              if (!o) {
                setEditingGroup(null);
                if (editId) void navigate({ to: "/monitors", search: { edit: undefined }, replace: true });
              }
            }}
            onSaved={() => {
              setEditingGroup(null);
              if (editId) void navigate({ to: "/monitors", search: { edit: undefined }, replace: true });
              invalidate();
            }}
          />
          <Dialog open={deletingGroup !== null} onOpenChange={(o) => !o && setDeletingGroup(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete search group</DialogTitle>
                <DialogDescription>
                  Permanently remove <code className="font-mono">{deletingGroup?.id}</code> and all
                  platform executions?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeletingGroup(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={removeGroup.isPending}
                  onClick={() => deletingGroup && removeGroup.mutate(deletingGroup.id)}
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
