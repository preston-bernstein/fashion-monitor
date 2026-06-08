import { z } from "zod";
import { PLATFORMS } from "@fm/shared/platforms.js";

export const MONITOR_STATUSES = ["active", "needs_revision", "paused"] as const;

export const monitorSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "ID is required")
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash, underscore only"),
  platform: z.enum(PLATFORMS),
  query_text: z.string().trim().min(1, "Query is required").max(500),
  status: z.enum(MONITOR_STATUSES),
  enabled: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export type MonitorValues = z.infer<typeof monitorSchema>;
