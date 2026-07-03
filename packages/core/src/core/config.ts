import { z } from "zod";
import { MONITOR_STATUSES, PLATFORMS } from "@fm/shared/platforms.js";
import {
  LlmConfigSchema,
  MeasurementsSchema,
  PriceCeilingSchema,
  type LlmConfig,
  type Measurements,
} from "@fm/shared/schemas/config.js";

const PlatformSchema = z.enum(PLATFORMS);

export const SearchQuerySchema = z.object({
  id: z.string().min(1),
  q: z.string().min(1),
  groupId: z.string().optional(),
  enabled: z.boolean().default(true),
  status: z.enum(MONITOR_STATUSES).default("active"),
  note: z.string().optional(),
});

export type SearchQueryDef = z.infer<typeof SearchQuerySchema>;

export { MeasurementsSchema, PriceCeilingSchema, LlmConfigSchema };
export type { Measurements, LlmConfig };

export const AlertConfigSchema = z.object({
  ntfy_url: z.string().min(1),
  ntfy_topic: z.string().min(1).default("fashion-monitor"),
  ntfy_token: z.string().optional(),
  mode: z.enum(["immediate", "digest"]).default("immediate"),
  notify_empty: z.boolean().default(false),
});

export const ConfigSchema = z.object({
  profile_id: z.string().default("default"),
  measurements: MeasurementsSchema,
  aesthetic_prompt: z.string().min(1),
  hard_no: z.array(z.string()).default([]),
  positive_signals: z
    .object({
      strong: z.array(z.string()).default([]),
      weak: z.array(z.string()).default([]),
    })
    .default({ strong: [], weak: [] }),
  price_ceiling: PriceCeilingSchema,
  platforms: z.partialRecord(PlatformSchema, z.boolean()),
  searches: z.partialRecord(PlatformSchema, z.array(SearchQuerySchema)).optional(),
  llm: LlmConfigSchema.optional(),
  alert: AlertConfigSchema,
  database: z
    .object({
      path: z.string().default("data/fashion_monitor.db"),
    })
    .default({ path: "data/fashion_monitor.db" }),
  scraper: z
    .object({
      poshmark_profile_path: z.string().default("data/poshmark-profile"),
    })
    .default({ poshmark_profile_path: "data/poshmark-profile" }),
});

export const ConfigSchemaWithDefaults = ConfigSchema.transform((cfg) => ({
  ...cfg,
  llm: LlmConfigSchema.parse(cfg.llm ?? {}),
}));

export type Config = z.infer<typeof ConfigSchemaWithDefaults>;
export type AlertConfig = z.infer<typeof AlertConfigSchema>;

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

export function substituteEnvVars(value: string): string {
  return value.replace(ENV_PATTERN, (_, name: string) => {
    const envVal = process.env[name];
    if (envVal === undefined) {
      throw new Error(`Missing environment variable: ${name}`);
    }
    return envVal;
  });
}

function walkAndSubstitute(obj: unknown): unknown {
  if (typeof obj === "string") {
    return ENV_PATTERN.test(obj) ? substituteEnvVars(obj) : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(walkAndSubstitute);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, walkAndSubstitute(v)]));
  }
  return obj;
}

export function parseConfig(raw: unknown): Config {
  const substituted = walkAndSubstitute(raw);
  return ConfigSchemaWithDefaults.parse(substituted);
}
