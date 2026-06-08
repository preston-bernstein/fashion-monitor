import type { PreparedListing, ScoringResult } from "../core/types.js";

export interface LLMProvider {
  scoreBatch(listings: PreparedListing[], systemPrompt: string): Promise<ScoringResult[]>;
  scoreWithImage(listing: PreparedListing, systemPrompt: string): Promise<ScoringResult>;
  healthCheck(): Promise<boolean>;
}

export function maybeResult(listingId: string, reason: string): ScoringResult {
  return {
    listing_id: listingId,
    score: "MAYBE",
    quality: "uncertain",
    value: "uncertain",
    aesthetic: "uncertain",
    size: "UNCERTAIN",
    reason: reason.slice(0, 120),
  };
}

export function reconcileBatchResults(
  listings: PreparedListing[],
  results: ScoringResult[],
): ScoringResult[] {
  const byId = new Map(results.map((r) => [r.listing_id, r]));
  return listings.map((listing) => {
    const found = byId.get(listing.listing_id);
    if (found) return found;
    return maybeResult(listing.listing_id, "Missing from LLM batch response");
  });
}
