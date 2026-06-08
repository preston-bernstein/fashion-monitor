import { z } from "zod";

export const ScoringResultSchema = z.object({
  listing_id: z.string(),
  score: z.enum(["YES", "MAYBE", "NO"]),
  quality: z.enum(["pass", "fail", "uncertain"]),
  value: z.enum(["pass", "fail", "uncertain"]),
  aesthetic: z.enum(["pass", "fail", "uncertain"]),
  size: z.enum(["HIGH", "UNCERTAIN", "UNLIKELY"]),
  reason: z.string().max(200),
});

export const BatchSchema = z.array(ScoringResultSchema);

export type ParsedScoringResult = z.infer<typeof ScoringResultSchema>;
