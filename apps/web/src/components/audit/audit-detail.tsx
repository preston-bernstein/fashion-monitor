import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatDetailValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function AuditDetailCell({ detail }: { detail: string | null }) {
  const [open, setOpen] = useState(false);

  if (!detail) {
    return <span className="text-muted-foreground">—</span>;
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(detail) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return <span className="text-muted-foreground">{detail}</span>;
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="max-w-md">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto px-1 py-0.5 font-normal"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {open ? "Hide detail" : `${entries.length} fields`}
      </Button>
      {open ? (
        <dl className="mt-1 space-y-1 rounded border bg-muted/30 p-2 text-xs">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt className="font-medium text-foreground">{key}</dt>
              <dd className="whitespace-pre-wrap break-all font-mono text-muted-foreground">
                {formatDetailValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
