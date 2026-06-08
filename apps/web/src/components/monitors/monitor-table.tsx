import { MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import type { Monitor } from "@fm/shared/dto.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MonitorStatusBadge } from "@/components/monitors/monitor-badges";
import { cn } from "@/lib/utils";

export function MonitorTable({
  monitors,
  canWrite,
  highlightId,
  onEdit,
  onToggle,
  onDelete,
}: {
  monitors: Monitor[];
  canWrite: boolean;
  highlightId?: string;
  onEdit: (monitor: Monitor) => void;
  onToggle: (monitor: Monitor) => void;
  onDelete: (monitor: Monitor) => void;
}) {
  if (monitors.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <p className="p-6 text-sm text-muted-foreground">No monitors yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Query</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note</TableHead>
              {canWrite ? <TableHead className="w-10" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {monitors.map((m) => (
              <TableRow
                key={m.id}
                className={cn(highlightId === m.id && "bg-accent/40")}
              >
                <TableCell>
                  <code className="font-mono text-xs">{m.id}</code>
                </TableCell>
                <TableCell>{m.platform}</TableCell>
                <TableCell className="max-w-xs truncate">{m.query_text}</TableCell>
                <TableCell>
                  <MonitorStatusBadge status={m.status} enabled={m.enabled} />
                </TableCell>
                <TableCell className="text-muted-foreground">{m.note ?? ""}</TableCell>
                {canWrite ? (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(m)}>
                          <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onToggle(m)}>
                          {m.enabled ? (
                            <>
                              <Pause className="size-4" /> Pause
                            </>
                          ) : (
                            <>
                              <Play className="size-4" /> Activate
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDelete(m)}
                        >
                          <Trash2 className="size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
