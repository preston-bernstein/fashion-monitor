import type { ConnectionStatus } from "@fm/shared/dto.js";
import { Badge } from "@/components/ui/badge";

const LABELS: Record<ConnectionStatus, string> = {
  ok: "Connected",
  degraded: "Degraded",
  failed: "Failed",
  untested: "Untested",
  not_connected: "Not connected",
};

const VARIANTS: Record<ConnectionStatus, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  ok: "success",
  degraded: "warning",
  failed: "destructive",
  untested: "secondary",
  not_connected: "outline",
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
