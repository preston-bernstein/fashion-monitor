import { z } from "zod";

export const SecretInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/, "key may only contain letters, numbers, dot, dash, underscore"),
  value: z.string().min(1).max(4000),
});

export const KNOWN_SECRETS = [
  "ntfy_token",
  "anthropic_api_key",
  "ebay_client_id",
  "ebay_client_secret",
  "grailed_app_id",
  "grailed_api_key",
  "scrapfly_api_key",
] as const;
