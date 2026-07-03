import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut, ApiError } from "@/lib/api";
import { toastApiError } from "@/lib/mutation-toast";
import type { SecretsResponse } from "@fm/shared/dto.js";
import { fmtDateTime } from "@/lib/format";
import { LoadingPage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IntegrationFailuresTable,
  IntegrationUptimeTable,
} from "@/components/system/integration-health-table";

const secretForm = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Key is required")
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash, underscore only"),
  value: z.string().min(1, "Value is required"),
});

type SecretForm = z.infer<typeof secretForm>;

export function SecretsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["secrets"],
    queryFn: () => apiGet<SecretsResponse>("/api/secrets"),
  });

  const form = useForm<SecretForm>({
    resolver: zodResolver(secretForm),
    defaultValues: { key: "", value: "" },
  });

  const setSecret = useMutation({
    mutationFn: (v: SecretForm) => apiPut("/api/secrets", v),
    onSuccess: () => {
      toast.success("Secret saved");
      form.reset({ key: "", value: "" });
      queryClient.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (e: ApiError) => toastApiError(e),
  });

  const trigger = useMutation({
    mutationFn: () => apiPost("/api/pipeline/trigger"),
    onSuccess: () => {
      toast.success("Pipeline run requested");
      queryClient.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (e: ApiError) => toastApiError(e),
  });

  if (isLoading || !data) return <LoadingPage />;
  const knownSet = new Set(data.secrets.map((s) => s.key));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Secrets</CardTitle>
          <CardDescription>
            Encrypted at rest. Values are write-only and never returned to the browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.storeEnabled ? (
            <p className="text-sm text-destructive">
              Secret store is disabled. Set <code className="font-mono">SECRETS_KEY</code> to enable
              it.
            </p>
          ) : (
            <>
              {data.secrets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No secrets stored yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.secrets.map((s) => (
                      <TableRow key={s.key}>
                        <TableCell>
                          <code className="font-mono text-xs">{s.key}</code>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {fmtDateTime(s.updated_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {data.canWrite ? (
                <Form {...form}>
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={form.handleSubmit((v) => setSecret.mutate(v))}
                  >
                    <FormField
                      control={form.control}
                      name="key"
                      render={({ field }) => (
                        <FormItem className="grow">
                          <FormLabel>Key</FormLabel>
                          <FormControl>
                            <Input list="known-secrets" placeholder="ntfy_token" {...field} />
                          </FormControl>
                          <datalist id="known-secrets">
                            {data.knownSecrets.map((k) => (
                              <option key={k} value={k}>
                                {knownSet.has(k) ? "(set)" : ""}
                              </option>
                            ))}
                          </datalist>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="value"
                      render={({ field }) => (
                        <FormItem className="grow">
                          <FormLabel>Value</FormLabel>
                          <FormControl>
                            <Input type="password" autoComplete="off" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" disabled={setSecret.isPending}>
                      Save secret
                    </Button>
                  </form>
                </Form>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {data.canTrigger ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trigger run</CardTitle>
            <CardDescription>
              Flags a run request the cron runner picks up on its next tick.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <Button onClick={() => trigger.mutate()} disabled={trigger.isPending}>
              Request pipeline run
            </Button>
            {data.runRequestedAt ? (
              <span className="text-sm text-muted-foreground">
                Last requested {fmtDateTime(data.runRequestedAt)}
              </span>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrationUptimeTable uptime={data.uptime} />
        <IntegrationFailuresTable failures={data.failures} />
      </div>
    </div>
  );
}
