import type { Platform } from "@fm/shared/platforms.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

export function PlatformBadges({
  platforms,
  size = "default",
  variant = "secondary",
}: {
  platforms: readonly (Platform | string)[];
  size?: "default" | "sm";
  variant?: "secondary" | "outline";
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map((platform) => (
        <Badge
          key={platform}
          variant={variant}
          className={cn("capitalize", size === "sm" && "px-1.5 py-0 text-xs font-normal")}
        >
          {platform}
        </Badge>
      ))}
    </div>
  );
}
