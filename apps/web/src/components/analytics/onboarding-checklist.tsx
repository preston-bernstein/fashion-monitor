import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, X } from "lucide-react";
import type {
  ConnectionsResponse,
  MonitorsResponse,
  OnboardingResponse,
  TasteResponse,
} from "@fm/shared/dto.js";
import { apiGet, apiPost } from "@/lib/api";
import { useCan } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  to: string;
  search?: Record<string, string>;
}

function Step({ item }: { item: ChecklistItem }) {
  return (
    <Link
      to={item.to}
      search={item.search}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
        item.done ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {item.done ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className={cn(item.done && "line-through")}>{item.label}</span>
    </Link>
  );
}

export function OnboardingChecklist() {
  const can = useCan();
  const queryClient = useQueryClient();
  const showNtfyStep = can("secrets:read");

  const onboarding = useQuery({
    queryKey: ["onboarding"],
    queryFn: () => apiGet<OnboardingResponse>("/api/onboarding"),
  });
  const taste = useQuery({
    queryKey: ["taste"],
    queryFn: () => apiGet<TasteResponse>("/api/taste"),
  });
  const monitors = useQuery({
    queryKey: ["monitors"],
    queryFn: () => apiGet<MonitorsResponse>("/api/monitors"),
  });
  const connections = useQuery({
    queryKey: ["connections"],
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections"),
    enabled: showNtfyStep,
  });

  const dismiss = useMutation({
    mutationFn: () => apiPost("/api/onboarding/dismiss"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const loading =
    onboarding.isLoading ||
    taste.isLoading ||
    monitors.isLoading ||
    (showNtfyStep && connections.isLoading);
  if (loading || !onboarding.data || !taste.data || !monitors.data) return null;
  if (onboarding.data.dismissed) return null;

  const tasteSet = taste.data.taste.aesthetic_prompt.trim().length > 0;
  const hasMonitor = monitors.data.groups.length > 0;
  const ntfyOk =
    !showNtfyStep ||
    connections.data?.connections.find((c) => c.platform === "ntfy")?.status === "ok";

  const items: ChecklistItem[] = [
    { key: "taste", label: "Set your Taste", done: tasteSet, to: "/taste" },
    { key: "monitor", label: "Add your first Monitor", done: hasMonitor, to: "/monitors" },
  ];
  if (showNtfyStep) {
    items.push({
      key: "ntfy",
      label: "Connect ntfy and test it",
      done: ntfyOk,
      to: "/connections",
    });
  }
  items.push({
    key: "platforms",
    label: "Optionally connect platform accounts",
    done: true,
    to: "/connections",
  });

  const allDone = tasteSet && hasMonitor && ntfyOk;
  if (allDone) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Get started</CardTitle>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          aria-label="Dismiss checklist"
        >
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.map((item) => (
          <Step key={item.key} item={item} />
        ))}
        {!showNtfyStep ? (
          <p className="pt-1 text-xs text-muted-foreground">
            Ask an owner or admin to connect an alert destination for you.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
