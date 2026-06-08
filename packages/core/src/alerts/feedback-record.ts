import type { Platform } from "../core/types.js";
import type { AlertLogRepo } from "../storage/repos/alert-log.js";

export interface FeedbackRecordInput {
  platform: Platform;
  listing_id: string;
  signal: "positive" | "negative";
  caption?: string | null;
}

export function buildFeedbackInsert(
  input: FeedbackRecordInput,
  alertLog: AlertLogRepo,
): {
  platform: Platform;
  listing_id: string;
  signal: "positive" | "negative";
  title?: string | null;
  brand?: string | null;
  description?: string | null;
  price?: number | null;
  source_query_id?: string | null;
} {
  const alert = alertLog.findLatest(input.platform, input.listing_id);

  return {
    platform: input.platform,
    listing_id: input.listing_id,
    signal: input.signal,
    title: alert?.title ?? null,
    brand: alert?.brand ?? null,
    price: alert?.price ?? null,
    description: alert?.llm_reason ?? input.caption ?? null,
    source_query_id: alert?.source_query_id ?? null,
  };
}
