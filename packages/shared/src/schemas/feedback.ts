import { z } from "zod";
import { PLATFORMS } from "../platforms.js";

export const FeedbackCreateInputSchema = z.object({
  platform: z.enum(PLATFORMS),
  listing_id: z.string().trim().min(1).max(200),
  signal: z.enum(["positive", "negative"]),
});

export type FeedbackCreateInput = z.infer<typeof FeedbackCreateInputSchema>;
