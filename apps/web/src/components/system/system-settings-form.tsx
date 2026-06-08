import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPut, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import type { SystemResponse } from "@fm/shared/dto.js";
import { LoadingPage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { OptionSelect } from "@/components/system/option-select";

const systemForm = z.object({
  platforms: z.record(z.string(), z.boolean()),
  provider: z.enum(["ollama", "claude", "hybrid", "mock"]),
  batch_size: z
    .string()
    .trim()
    .refine((v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 1 && n <= 30;
    }, "1–30"),
  ollama_host: z.string().trim(),
  ollama_text_model: z.string().trim().min(1, "Required"),
  ollama_vision_model: z.string().trim(),
  claude_model: z.string().trim().min(1, "Required"),
  vision_backend: z.enum(["ollama", "claude"]),
  alert_mode: z.enum(["immediate", "digest"]),
  notify_empty: z.boolean(),
  poshmark_profile_path: z.string().trim().min(1, "Required"),
});

type SystemForm = z.infer<typeof systemForm>;

export function SystemSettingsForm() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["system"],
    queryFn: () => apiGet<SystemResponse>("/api/system"),
  });

  const canWrite = data?.canWrite ?? false;
  const platformList = data?.options.platforms ?? [];

  const form = useForm<SystemForm>({
    resolver: zodResolver(systemForm),
    values: {
      platforms: Object.fromEntries(
        platformList.map((p) => [p, data?.system.platforms[p] ?? false]),
      ),
      provider: data?.system.llm.provider ?? "ollama",
      batch_size: (data?.system.llm.batch_size ?? 15).toString(),
      ollama_host: data?.system.llm.ollama_host ?? "",
      ollama_text_model: data?.system.llm.ollama_text_model ?? "qwen2.5:7b",
      ollama_vision_model: data?.system.llm.ollama_vision_model ?? "",
      claude_model: data?.system.llm.claude_model ?? "claude-haiku-4-5",
      vision_backend: data?.system.llm.vision_backend ?? "ollama",
      alert_mode: data?.system.alert_options.mode ?? "immediate",
      notify_empty: data?.system.alert_options.notify_empty ?? false,
      poshmark_profile_path: data?.system.scraper.poshmark_profile_path ?? "data/poshmark-profile",
    },
  });

  const save = useMutation({
    mutationFn: (v: SystemForm) =>
      apiPut("/api/system", {
        platforms: v.platforms,
        llm: {
          provider: v.provider,
          batch_size: Number(v.batch_size),
          ollama_host: v.ollama_host.trim() || undefined,
          ollama_text_model: v.ollama_text_model.trim(),
          ollama_vision_model: v.ollama_vision_model.trim() || undefined,
          claude_model: v.claude_model.trim(),
          vision_backend: v.vision_backend,
        },
        alert_options: { mode: v.alert_mode, notify_empty: v.notify_empty },
        scraper: { poshmark_profile_path: v.poshmark_profile_path.trim() },
      }),
    onSuccess: () => {
      toast.success("System settings saved");
      queryClient.invalidateQueries({ queryKey: ["system"] });
    },
    onError: (e: ApiError) => toastApiError(e, "Invalid settings"),
  });

  if (isLoading || !data) return <LoadingPage />;

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Platforms</CardTitle>
            <CardDescription>Marketplaces the pipeline scrapes.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            {platformList.map((p) => (
              <FormField
                key={p}
                control={form.control}
                name={`platforms.${p}`}
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                        disabled={!canWrite}
                        id={`platform-${p}`}
                      />
                    </FormControl>
                    <Label htmlFor={`platform-${p}`} className="font-normal">
                      {p}
                    </Label>
                  </FormItem>
                )}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">LLM</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <OptionSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    options={data.options.providers}
                    disabled={!canWrite}
                  />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="batch_size"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch size</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} max={30} disabled={!canWrite} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ollama_host"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ollama host</FormLabel>
                  <FormControl>
                    <Input placeholder="http://localhost:11434" disabled={!canWrite} {...field} />
                  </FormControl>
                  <FormDescription>Leave blank to use the default.</FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ollama_text_model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ollama text model</FormLabel>
                  <FormControl>
                    <Input disabled={!canWrite} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ollama_vision_model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ollama vision model</FormLabel>
                  <FormControl>
                    <Input disabled={!canWrite} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="claude_model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Claude model</FormLabel>
                  <FormControl>
                    <Input disabled={!canWrite} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vision_backend"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vision backend</FormLabel>
                  <OptionSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    options={data.options.visionBackends}
                    disabled={!canWrite}
                  />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alerts &amp; scraper</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="alert_mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alert mode</FormLabel>
                  <OptionSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    options={data.options.alertModes}
                    disabled={!canWrite}
                  />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="poshmark_profile_path"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Poshmark profile path</FormLabel>
                  <FormControl>
                    <Input disabled={!canWrite} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="notify_empty"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
                  <div>
                    <FormLabel>Notify on empty runs</FormLabel>
                    <FormDescription>Send an alert even when nothing matched.</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!canWrite}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {canWrite ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              Save system
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Read-only for your role.</p>
        )}
      </form>
    </Form>
  );
}
