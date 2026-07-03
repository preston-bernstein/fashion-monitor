import type { Config } from "../core/config.js";
import type { Listing, ScoredListing, ScoringResult } from "../core/types.js";
import { prepareForLLM } from "../core/types.js";
import { chunk } from "../lib/batch.js";
import { LogEvents } from "../lib/log-events.js";
import { createLogger } from "../lib/logging.js";
import type { LLMProvider } from "../llm/provider.js";
import { buildSystemPrompt } from "../llm/prompt-builder.js";
import type { FeedbackRepo } from "../storage/repos/feedback.js";

const log = createLogger("pipeline.scorer");

export interface ScorePipelineResult {
  scored: ScoredListing[];
  yes: ScoringResult[];
  maybe: ScoringResult[];
  no: ScoringResult[];
}

export async function scoreListings(
  listings: Listing[],
  config: Config,
  provider: LLMProvider,
  feedbackRepo: FeedbackRepo,
): Promise<ScorePipelineResult> {
  const systemPrompt = buildSystemPrompt(config, feedbackRepo);
  const prepared = listings.map(prepareForLLM);
  const batchSize = config.llm.batch_size;
  const allResults: ScoringResult[] = [];

  for (const batch of chunk(prepared, batchSize)) {
    log.info(LogEvents.PipelineScorerBatchStart, { count: batch.length });
    const results = await provider.scoreBatch(batch, systemPrompt);
    allResults.push(...results);
  }

  const maybeItems = allResults.filter((r) => r.score === "MAYBE");
  const preparedById = new Map(prepared.map((p) => [p.listing_id, p]));

  for (const maybe of maybeItems) {
    const prep = preparedById.get(maybe.listing_id);
    if (!prep?.image_url) continue;

    log.info(LogEvents.PipelineScorerVisionStart, { listing_id: maybe.listing_id });
    const visionResult = await provider.scoreWithImage(prep, systemPrompt);
    log.info(LogEvents.PipelineScorerVisionFlip, {
      listing_id: maybe.listing_id,
      text_verdict: maybe.score,
      vision_verdict: visionResult.score,
      flipped: maybe.score !== visionResult.score,
    });
    const idx = allResults.findIndex((r) => r.listing_id === maybe.listing_id);
    if (idx >= 0) allResults[idx] = visionResult;
  }

  const listingById = new Map(listings.map((l) => [`${l.platform}:${l.id}`, l]));
  const scored: ScoredListing[] = allResults
    .map((result) => {
      const listing = listingById.get(result.listing_id);
      if (!listing) return null;
      return { listing, result };
    })
    .filter((s): s is ScoredListing => s !== null);

  return {
    scored,
    yes: allResults.filter((r) => r.score === "YES"),
    maybe: allResults.filter((r) => r.score === "MAYBE"),
    no: allResults.filter((r) => r.score === "NO"),
  };
}

export function filterAlertable(scored: ScoredListing[]): ScoredListing[] {
  return scored.filter((s) => s.result.score === "YES" || s.result.score === "MAYBE");
}
