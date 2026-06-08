import { z } from "zod";
import { IMPLEMENTED_PLATFORMS } from "@fm/shared/platforms.js";

export const MONITOR_STATUSES = ["active", "needs_revision", "paused"] as const;

export const searchGroupSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "ID is required")
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash, underscore only"),
  query_text: z.string().trim().min(1, "Query is required").max(500),
  platforms: z.array(z.enum(IMPLEMENTED_PLATFORMS)).min(1, "Select at least one platform"),
  status: z.enum(MONITOR_STATUSES),
  enabled: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export type SearchGroupValues = z.infer<typeof searchGroupSchema>;
