import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPatch, apiPost, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import type { Monitor, Platform } from "@fm/shared/dto.js";
import { IMPLEMENTED_PLATFORMS } from "@fm/shared/platforms.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { MONITOR_STATUSES, monitorSchema, type MonitorValues } from "@/components/monitors/monitor-schema";

export function MonitorDialog({
  open,
  mode,
  monitor,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  monitor?: Monitor;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const form = useForm<MonitorValues>({
    resolver: zodResolver(monitorSchema),
    values: {
      id: monitor?.id ?? "",
      platform: (monitor?.platform ?? "ebay") as Platform,
      query_text: monitor?.query_text ?? "",
      status: (monitor?.status as MonitorValues["status"]) ?? "active",
      enabled: monitor?.enabled ?? true,
      note: monitor?.note ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (values: MonitorValues) => {
      const body = { ...values, note: values.note?.trim() ? values.note.trim() : null };
      if (mode === "create") return apiPost("/api/monitors", body);
      const { id: _id, ...rest } = body;
      return apiPatch(`/api/monitors/${encodeURIComponent(monitor!.id)}`, rest);
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Monitor created" : "Monitor saved");
      onSaved();
    },
    onError: (e: ApiError) => {
      if (e.code === "duplicate") form.setError("id", { message: e.message });
      else toastApiError(e);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add monitor" : "Edit monitor"}</DialogTitle>
          <DialogDescription>
            Define a marketplace search query for the scoring pipeline.
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
                    <Input placeholder="ebay-corduroy" disabled={mode === "edit"} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Platform</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {IMPLEMENTED_PLATFORMS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
