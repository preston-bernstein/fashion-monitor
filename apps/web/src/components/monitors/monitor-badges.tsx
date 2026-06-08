import { Badge } from "@/components/ui/badge";

export function statusVariant(status: string): "success" | "warning" | "secondary" {
  if (status === "active") return "success";
  if (status === "needs_revision") return "warning";
  return "secondary";
}

export function MonitorStatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant={statusVariant(status)}>{status}</Badge>
      {!enabled ? <span className="text-xs text-muted-foreground">disabled</span> : null}
    </div>
  );
}
