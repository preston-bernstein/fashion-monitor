import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import type { SearchGroup } from "@fm/shared/dto.js";
import { LazyImage } from "@/components/common/lazy-image";
import { MonitorImageManager } from "@/components/monitors/monitor-image-manager";
import { fetchMonitorImages, monitorImagesQueryKey } from "@/lib/monitor-images-query";
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
import { MonitorStatusBadge, PlatformBadges } from "@/components/monitors/monitor-badges";
import { cn } from "@/lib/utils";

function GroupRow({
  group,
  canWrite,
  highlightId,
  expanded,
  onToggleExpand,
  onEdit,
  onToggle,
  onDelete,
}: {
  group: SearchGroup;
  canWrite: boolean;
  highlightId?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: (group: SearchGroup) => void;
  onToggle: (group: SearchGroup) => void;
  onDelete: (group: SearchGroup) => void;
}) {
  const { data: gallery } = useQuery({
    queryKey: monitorImagesQueryKey(group.id),
    queryFn: () => fetchMonitorImages(group.id),
    enabled: expanded,
    staleTime: 60_000,
  });

  const displayImages =
    gallery && gallery.curated.length > 0
      ? gallery.curated.map((img) => img.url)
      : (gallery?.fallback.map((img) => img.url) ?? []);

  return (
    <>
      <TableRow className={cn(highlightId === group.id && "bg-accent/40")}>
        <TableCell className="w-8">
          <Button variant="ghost" size="icon" className="size-7" onClick={onToggleExpand}>
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        </TableCell>
        <TableCell>
          <code className="font-mono text-xs">{group.id}</code>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-2">
            <PlatformBadges platforms={group.platforms} />
            {group.platforms.length === 1 && canWrite ? (
              <span className="text-xs text-muted-foreground">Edit to add platforms</span>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="max-w-xs truncate">{group.query_text}</TableCell>
        <TableCell>
          <MonitorStatusBadge status={group.status} enabled={group.enabled} />
        </TableCell>
        <TableCell className="text-muted-foreground">{group.note ?? ""}</TableCell>
        {canWrite ? (
          <TableCell>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(group)}>
                  <Pencil className="size-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onToggle(group)}>
                  {group.enabled ? (
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
                  onClick={() => onDelete(group)}
                >
                  <Trash2 className="size-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        ) : null}
      </TableRow>
      {expanded && canWrite && gallery ? (
        <TableRow className="bg-muted/20">
          <TableCell />
          <TableCell colSpan={6}>
            <MonitorImageManager groupId={group.id} gallery={gallery} />
          </TableCell>
        </TableRow>
      ) : null}
      {expanded && !canWrite && displayImages.length > 0 ? (
        <TableRow className="bg-muted/20">
          <TableCell />
          <TableCell colSpan={5}>
            <div className="flex flex-wrap items-center gap-2 py-1">
              <span className="text-xs text-muted-foreground">Images</span>
              {displayImages.slice(0, 6).map((url) => (
                <LazyImage
                  key={url}
                  src={url}
                  alt={`${group.id} listing`}
                  className="size-14 shrink-0"
                />
              ))}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
      {expanded
        ? (group.executions ?? []).map((exec) => (
            <TableRow key={exec.id} className="bg-muted/30">
              <TableCell />
              <TableCell className="pl-8">
                <div className="space-y-0.5">
                  <span className="text-xs text-muted-foreground">Execution</span>
                  <code className="block font-mono text-xs text-muted-foreground">{exec.id}</code>
                </div>
              </TableCell>
              <TableCell>
                <PlatformBadges platforms={[exec.platform]} size="sm" variant="outline" />
              </TableCell>
              <TableCell className="max-w-xs truncate text-muted-foreground">
                {exec.query_text === group.query_text ? (
                  <span className="text-xs italic">Same as group query</span>
                ) : (
                  exec.query_text
                )}
              </TableCell>
              <TableCell>
                <MonitorStatusBadge status={exec.status} enabled={exec.enabled} />
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {exec.last_error ? (
                  <span className="text-destructive" title={exec.last_error}>
                    {exec.last_error}
                  </span>
                ) : exec.last_run_at ? (
                  `Last run ${new Date(exec.last_run_at).toLocaleString()}`
                ) : (
                  "No runs yet"
                )}
              </TableCell>
              {canWrite ? <TableCell /> : null}
            </TableRow>
          ))
        : null}
    </>
  );
}

export function MonitorTable({
  groups,
  canWrite,
  highlightId,
  onEditGroup,
  onToggleGroup,
  onDeleteGroup,
}: {
  groups: SearchGroup[];
  canWrite: boolean;
  highlightId?: string;
  onEditGroup: (group: SearchGroup) => void;
  onToggleGroup: (group: SearchGroup) => void;
  onDeleteGroup: (group: SearchGroup) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <p className="p-6 text-sm text-muted-foreground">No search groups yet.</p>
        </CardContent>
      </Card>
    );
  }

  const singlePlatformCount = groups.filter((g) => g.platforms.length === 1).length;

  return (
    <Card>
      <CardContent className="p-0">
        {singlePlatformCount > 0 && canWrite ? (
          <p className="border-b px-4 py-3 text-sm text-muted-foreground">
            Each row is one search group. Expand a row for per-platform execution status.
            {singlePlatformCount === groups.length
              ? " These groups have one platform each — edit a group to fan out to more marketplaces."
              : null}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Group ID</TableHead>
              <TableHead>Platforms</TableHead>
              <TableHead>Query</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Note / last run</TableHead>
              {canWrite ? <TableHead className="w-10" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <GroupRow
                key={g.id}
                group={g}
                canWrite={canWrite}
                highlightId={highlightId}
                expanded={expanded.has(g.id) || highlightId === g.id}
                onToggleExpand={() => toggleExpand(g.id)}
                onEdit={onEditGroup}
                onToggle={onToggleGroup}
                onDelete={onDeleteGroup}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
