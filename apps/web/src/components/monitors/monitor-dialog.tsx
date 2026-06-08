import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPatch, apiPost, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import type { SearchGroup } from "@fm/shared/dto.js";
import { IMPLEMENTED_PLATFORMS, type Platform } from "@fm/shared/platforms.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  MONITOR_STATUSES,
  searchGroupSchema,
  type SearchGroupValues,
} from "@/components/monitors/search-group-schema";

export function MonitorDialog({
  open,
  mode,
  group,
  defaultPlatforms,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  group?: SearchGroup;
  defaultPlatforms?: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const implemented = IMPLEMENTED_PLATFORMS as readonly Platform[];
  const filterPlatforms = (platforms: Platform[] | undefined): SearchGroupValues["platforms"] => {
    const filtered = (platforms ?? []).filter((p): p is SearchGroupValues["platforms"][number] =>
      (implemented as readonly string[]).includes(p),
    );
    return filtered.length > 0 ? filtered : ["ebay"];
  };

  const form = useForm<SearchGroupValues>({
    resolver: zodResolver(searchGroupSchema),
    values: {
      id: group?.id ?? "",
      query_text: group?.query_text ?? "",
      platforms: group
        ? filterPlatforms(group.platforms)
        : filterPlatforms(defaultPlatforms as Platform[]),
      status: (group?.status as SearchGroupValues["status"]) ?? "active",
      enabled: group?.enabled ?? true,
      note: group?.note ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (values: SearchGroupValues) => {
      const body = {
        ...values,
        note: values.note?.trim() ? values.note.trim() : undefined,
      };
      if (mode === "create") return apiPost("/api/monitors", body);
      const { id: _id, ...rest } = body;
      return apiPatch(`/api/monitors/${encodeURIComponent(group!.id)}`, rest);
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Search group created" : "Search group saved");
      onSaved();
    },
    onError: (e: ApiError) => {
      if (e.code === "duplicate") form.setError("id", { message: e.message });
      else toastApiError(e);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add search group" : "Edit search group"}</DialogTitle>
          <DialogDescription>
            One query fans out to selected platforms. Pipeline aggregates listings under this group
            id.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <FormField
              control={form.control}
              name="id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ID</FormLabel>
                  <FormControl>
                    <Input placeholder="corduroy-jacket" disabled={mode === "edit"} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="query_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Query</FormLabel>
                  <FormControl>
                    <Input placeholder="men jacket corduroy XXL" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="platforms"
              render={() => (
                <FormItem>
                  <FormLabel>Platforms</FormLabel>
                  <FormDescription>
                    Scraped on each enabled marketplace. Select multiple to fan out one query.
                    {mode === "edit" && (group?.platforms.length ?? 0) === 1
                      ? " This group currently runs on one platform — add more below."
                      : null}
                  </FormDescription>
                  <div className="grid grid-cols-2 gap-2 rounded-lg border p-3">
                    {IMPLEMENTED_PLATFORMS.map((platform) => (
                      <FormField
                        key={platform}
                        control={form.control}
                        name="platforms"
                        render={({ field }) => (
                          <FormItem className="flex items-center gap-2 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(platform)}
                                onCheckedChange={(checked) => {
                                  const next = checked
                                    ? [...(field.value ?? []), platform]
                                    : (field.value ?? []).filter((p) => p !== platform);
                                  field.onChange(next);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal">{platform}</FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MONITOR_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Input placeholder="optional" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <FormLabel>Enabled</FormLabel>
                    <FormDescription>Scraped on the next scheduled run.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {mode === "create" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
