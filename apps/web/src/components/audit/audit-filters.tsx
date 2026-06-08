import type { AuditCategory } from "@fm/shared/dto.js";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AuditFiltersState {
  category: AuditCategory | "";
  actor: string;
}

const CATEGORIES: { value: AuditCategory | ""; label: string }[] = [
  { value: "", label: "All categories" },
  { value: "auth", label: "Auth" },
  { value: "monitors", label: "Monitors" },
  { value: "settings", label: "Settings" },
  { value: "secrets", label: "Secrets" },
  { value: "users", label: "Users" },
  { value: "system", label: "System" },
];

export function AuditFilters({
  value,
  onChange,
}: {
  value: AuditFiltersState;
  onChange: (next: AuditFiltersState) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="audit-category">Category</Label>
        <Select
          value={value.category || "all"}
          onValueChange={(v) =>
            onChange({ ...value, category: v === "all" ? "" : (v as AuditCategory) })
          }
        >
          <SelectTrigger id="audit-category" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value || "all"} value={c.value || "all"}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="audit-actor">Actor email</Label>
        <Input
          id="audit-actor"
          className="w-[240px]"
          placeholder="Filter by actor…"
          value={value.actor}
          onChange={(e) => onChange({ ...value, actor: e.target.value })}
        />
      </div>
    </div>
  );
}
