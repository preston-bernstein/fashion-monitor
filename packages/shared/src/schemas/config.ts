import { z } from "zod";
import { PLATFORMS } from "../platforms.js";

const PlatformSchema = z.enum(PLATFORMS);

export const MeasurementsSchema = z.object({
  height: z.string().optional(),
  weight_lbs: z.number().optional(),
  chest_in: z.string().optional(),
  waist_in: z.number().optional(),
  pants_size: z.string().optional(),
  dress_shirt_neck: z.number().optional(),
  dress_shirt_sleeve: z.string().optional(),
  typical_size: z.string().optional(),
});

export const PriceCeilingSchema = z.object({
  tops: z.number().optional(),
  pants: z.number().optional(),
  outerwear: z.number().optional(),
  default: z.number(),
});

export const LlmConfigSchema = z.object({
  provider: z.enum(["ollama", "claude", "hybrid", "mock"]).default("ollama"),
  batch_size: z.number().int().min(1).max(30).default(15),
  ollama_host: z.url().optional(),
  ollama_text_model: z.string().default("qwen2.5:7b"),
  ollama_vision_model: z.string().optional(),
  claude_model: z.string().default("claude-haiku-4-5"),
  vision_backend: z.enum(["ollama", "claude"]).default("ollama"),
});

export const LLM_PROVIDERS = ["ollama", "claude", "hybrid", "mock"] as const;
export const VISION_BACKENDS = ["ollama", "claude"] as const;
export const ALERT_MODES = ["immediate", "digest"] as const;

export const AlertOptionsSchema = z.object({
  mode: z.enum(ALERT_MODES).default("immediate"),
  notify_empty: z.boolean().default(false),
});

export const ScraperSettingsSchema = z.object({
  poshmark_profile_path: z.string().trim().min(1).default("data/poshmark-profile"),
});

export const TasteInputSchema = z.object({
  aesthetic_prompt: z.string().trim().min(1, "Aesthetic prompt is required"),
  hard_no: z.array(z.string().trim().min(1)).default([]),
  positive_signals: z
    .object({
      strong: z.array(z.string().trim().min(1)).default([]),
      weak: z.array(z.string().trim().min(1)).default([]),
    })
    .default({ strong: [], weak: [] }),
  price_ceiling: PriceCeilingSchema,
  measurements: MeasurementsSchema,
});

export const SystemInputSchema = z.object({
  platforms: z.partialRecord(PlatformSchema, z.boolean()).optional(),
  llm: LlmConfigSchema,
  alert_options: AlertOptionsSchema,
  scraper: ScraperSettingsSchema,
});

export type Measurements = z.infer<typeof MeasurementsSchema>;
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
