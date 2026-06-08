import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPut, ApiError } from "@/lib/api";
import type { TasteResponse } from "@fm/shared/dto.js";
import { PageHeader, RequireCapability, LoadingPage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const numericString = z
  .string()
  .trim()
  .refine((v) => v === "" || Number.isFinite(Number(v)), "Must be a number");

const tasteForm = z.object({
  aesthetic_prompt: z.string().trim().min(1, "Aesthetic prompt is required"),
  hard_no: z.string(),
  signals_strong: z.string(),
  signals_weak: z.string(),
  price_tops: numericString,
  price_pants: numericString,
  price_outerwear: numericString,
  price_default: numericString.refine((v) => v !== "", "Default price is required"),
  m_typical_size: z.string(),
  m_chest_in: z.string(),
  m_height: z.string(),
  m_pants_size: z.string(),
});

type TasteForm = z.infer<typeof tasteForm>;

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function num(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value);
}

export function TastePage() {
  return (
    <RequireCapability capability="taste:read">
      <TasteContent />
    </RequireCapability>
  );
}

function TasteContent() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["taste"],
    queryFn: () => apiGet<TasteResponse>("/api/taste"),
  });

  const canWrite = data?.canWrite ?? false;
  const t = data?.taste;

  const form = useForm<TasteForm>({
    resolver: zodResolver(tasteForm),
    values: {
      aesthetic_prompt: t?.aesthetic_prompt ?? "",
      hard_no: (t?.hard_no ?? []).join("\n"),
      signals_strong: (t?.positive_signals.strong ?? []).join("\n"),
      signals_weak: (t?.positive_signals.weak ?? []).join("\n"),
      price_tops: t?.price_ceiling.tops?.toString() ?? "",
      price_pants: t?.price_ceiling.pants?.toString() ?? "",
      price_outerwear: t?.price_ceiling.outerwear?.toString() ?? "",
      price_default: t?.price_ceiling.default?.toString() ?? "",
      m_typical_size: t?.measurements.typical_size ?? "",
      m_chest_in: t?.measurements.chest_in ?? "",
      m_height: t?.measurements.height ?? "",
      m_pants_size: t?.measurements.pants_size ?? "",
    },
  });

  const save = useMutation({
    mutationFn: (v: TasteForm) =>
      apiPut("/api/taste", {
        aesthetic_prompt: v.aesthetic_prompt.trim(),
        hard_no: lines(v.hard_no),
        positive_signals: { strong: lines(v.signals_strong), weak: lines(v.signals_weak) },
        price_ceiling: {
          tops: num(v.price_tops),
          pants: num(v.price_pants),
          outerwear: num(v.price_outerwear),
          default: num(v.price_default) ?? 0,
        },
        measurements: {
          typical_size: v.m_typical_size.trim() || undefined,
          chest_in: v.m_chest_in.trim() || undefined,
          height: v.m_height.trim() || undefined,
          pants_size: v.m_pants_size.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Taste settings saved");
      queryClient.invalidateQueries({ queryKey: ["taste"] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (isLoading || !data) return <LoadingPage />;

  return (
    <>
      <PageHeader
        title="Taste"
        description="Aesthetic prompt + signals fed to the scorer. Changes apply on the next run."
      />
      <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aesthetic</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="aesthetic_prompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Aesthetic prompt</FormLabel>
                    <FormControl>
                      <Textarea rows={5} disabled={!canWrite} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hard_no"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hard no</FormLabel>
                    <FormControl>
                      <Textarea rows={4} disabled={!canWrite} {...field} />
                    </FormControl>
                    <FormDescription>One phrase per line.</FormDescription>
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="signals_strong"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Strong positive signals</FormLabel>
                      <FormControl>
                        <Textarea rows={4} disabled={!canWrite} {...field} />
                      </FormControl>
                      <FormDescription>One per line.</FormDescription>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="signals_weak"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weak positive signals</FormLabel>
                      <FormControl>
                        <Textarea rows={4} disabled={!canWrite} {...field} />
                      </FormControl>
                      <FormDescription>One per line.</FormDescription>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Price ceiling ($)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <PriceField name="price_tops" label="Tops" disabled={!canWrite} />
              <PriceField name="price_pants" label="Pants" disabled={!canWrite} />
              <PriceField name="price_outerwear" label="Outerwear" disabled={!canWrite} />
              <PriceField name="price_default" label="Default" disabled={!canWrite} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Measurements</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-4">
              <TextField name="m_typical_size" label="Typical size" disabled={!canWrite} />
              <TextField name="m_chest_in" label="Chest (in)" disabled={!canWrite} />
              <TextField name="m_height" label="Height" disabled={!canWrite} />
              <TextField name="m_pants_size" label="Pants size" disabled={!canWrite} />
            </CardContent>
          </Card>

          {canWrite ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending}>
                Save taste
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Read-only for your role.</p>
          )}
        </form>
      </Form>
    </>
  );

  function PriceField({
    name,
    label,
    disabled,
  }: {
    name: keyof TasteForm;
    label: string;
    disabled: boolean;
  }) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <Input type="number" inputMode="numeric" disabled={disabled} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  function TextField({
    name,
    label,
    disabled,
  }: {
    name: keyof TasteForm;
    label: string;
    disabled: boolean;
  }) {
    return (
      <FormField
        control={form.control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <Input disabled={disabled} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }
}
