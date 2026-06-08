import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { apiGet } from "@/lib/api";
import type { AuditResponse } from "@fm/shared/dto.js";
import { fmtDateTime } from "@/lib/format";
import {
  auditActionLabel,
  auditActionSeverity,
  isMonitorTarget,
  isUserTarget,
} from "@/lib/audit-labels";
import { PageHeader, RequireCapability, LoadingPage } from "@/components/common";
import { AuditDetailCell } from "@/components/audit/audit-detail";
import { AuditFilters, type AuditFiltersState } from "@/components/audit/audit-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

function buildAuditUrl(filters: AuditFiltersState, offset: number): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (filters.category) params.set("category", filters.category);
  if (filters.actor.trim()) params.set("actor", filters.actor.trim());
  return `/api/audit?${params.toString()}`;
}

export function AuditPage() {
  return (
    <RequireCapability capability="system:read">
      <PageHeader
        title="Audit log"
        description="Recent security and configuration events for this profile."
      />
      <AuditContent />
    </RequireCapability>
  );
}

function AuditContent() {
  const [filters, setFilters] = useState<AuditFiltersState>({ category: "", actor: "" });
  const [offset, setOffset] = useState(0);

  const queryKey = useMemo(
    () => ["audit", filters.category, filters.actor.trim(), offset] as const,
    [filters, offset],
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => apiGet<AuditResponse>(buildAuditUrl(filters, offset)),
    refetchInterval: 60_000,
  });

  const onFiltersChange = (next: AuditFiltersState) => {
    setFilters(next);
    setOffset(0);
  };

  if (isLoading) return <LoadingPage />;
  if (isError || !data) {
    return <p className="text-sm text-destructive">Failed to load audit log: {String(error)}</p>;
  }

  return (
    <div className="space-y-4">
      <AuditFilters value={filters} onChange={onFiltersChange} />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {data.total === 0
            ? "No matching events"
            : `Showing ${data.offset + 1}–${data.offset + data.entries.length} of ${data.total}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!data.has_more}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      {data.entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((row) => {
                const severity = auditActionSeverity(row.action);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDateTime(row.recorded_at)}
                    </TableCell>
                    <TableCell>
                      {row.actor_email ? (
                        <Link
                          to="/users"
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          {row.actor_email}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={severity === "danger" ? "destructive" : "outline"}
                        className={cn(
                          severity === "danger" && "bg-destructive/10 text-destructive",
                        )}
                      >
                        {auditActionLabel(row.action)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.target ? (
                        isMonitorTarget(row.action, row.target) ? (
                          <Link
                            to="/monitors"
                            search={{ edit: row.target }}
                            className="font-mono text-xs underline underline-offset-2"
                          >
                            {row.target}
                          </Link>
                        ) : isUserTarget(row.action, row.target) ? (
                          <Link
                            to="/users"
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            {row.target}
                          </Link>
                        ) : (
                          <code className="font-mono text-xs">{row.target}</code>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <AuditDetailCell detail={row.detail} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
