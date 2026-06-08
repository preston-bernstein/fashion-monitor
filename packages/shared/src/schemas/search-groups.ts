import { z } from "zod";
import { MONITOR_STATUSES, PLATFORMS } from "../platforms.js";

const groupIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._-]+$/, "id may only contain letters, numbers, dot, dash, underscore");

export const SearchGroupCreateInputSchema = z.object({
  id: groupIdSchema,
  query_text: z.string().trim().min(1).max(500),
  /** Empty or omitted → all enabled platforms from profile config at create time. */
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  query_overrides: z.record(z.enum(PLATFORMS), z.string().trim().min(1).max(500)).optional(),
  status: z.enum(MONITOR_STATUSES).default("active"),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(500).optional(),
});

export const SearchGroupUpdateInputSchema = z.object({
  query_text: z.string().trim().min(1).max(500).optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  query_overrides: z.record(z.enum(PLATFORMS), z.string().trim().min(1).max(500)).nullable().optional(),
  status: z.enum(MONITOR_STATUSES).optional(),
  enabled: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type SearchGroupCreateInput = z.infer<typeof SearchGroupCreateInputSchema>;
export type SearchGroupUpdateInput = z.infer<typeof SearchGroupUpdateInputSchema>;

export const ExecutionDtoSchema = z.object({
  id: z.string(),
  platform: z.enum(PLATFORMS),
  query_text: z.string(),
  enabled: z.boolean(),
  status: z.string(),
  last_error: z.string().nullable().optional(),
  last_run_at: z.string().nullable().optional(),
});

export type ExecutionDto = z.infer<typeof ExecutionDtoSchema>;

export const SearchGroupDtoSchema = z.object({
  id: z.string(),
  query_text: z.string(),
  platforms: z.array(z.enum(PLATFORMS)),
  query_overrides: z.record(z.enum(PLATFORMS), z.string()).optional(),
  enabled: z.boolean(),
  status: z.string(),
  note: z.string().nullable(),
  updated_at: z.string(),
  executions: z.array(ExecutionDtoSchema),
});

export type SearchGroupDto = z.infer<typeof SearchGroupDtoSchema>;
