import { z } from "zod";
import { MONITOR_STATUSES, PLATFORMS } from "../platforms.js";

export const MonitorCreateInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/, "id may only contain letters, numbers, dot, dash, underscore"),
  platform: z.enum(PLATFORMS),
  query_text: z.string().trim().min(1).max(500),
  status: z.enum(MONITOR_STATUSES).default("active"),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(500).optional(),
});

export const MonitorUpdateInputSchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  query_text: z.string().trim().min(1).max(500).optional(),
  status: z.enum(MONITOR_STATUSES).optional(),
  enabled: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type MonitorCreateInput = z.infer<typeof MonitorCreateInputSchema>;
export type MonitorUpdateInput = z.infer<typeof MonitorUpdateInputSchema>;

export const MonitorDtoSchema = z.object({
  id: z.string(),
  platform: z.enum(PLATFORMS),
  query_text: z.string(),
  enabled: z.boolean(),
  status: z.string(),
  note: z.string().nullable(),
  updated_at: z.string(),
});

export type MonitorDto = z.infer<typeof MonitorDtoSchema>;
