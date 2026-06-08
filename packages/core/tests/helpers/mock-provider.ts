import type { PreparedListing, ScoringResult } from "../../src/core/types.js";
import { MockProvider } from "../../src/llm/mock.js";

export function yesScore(listingId: string, reason = "Test"): ScoringResult {
  return {
    listing_id: listingId,
    score: "YES",
    quality: "pass",
    value: "pass",
    aesthetic: "pass",
    size: "HIGH",
    reason,
  };
}

export function maybeScore(listingId: string, reason = "Needs vision"): ScoringResult {
  return {
    listing_id: listingId,
    score: "MAYBE",
    quality: "uncertain",
    value: "uncertain",
    aesthetic: "uncertain",
    size: "UNCERTAIN",
    reason,
  };
}

export function yesBatchProvider(reason = "Test"): MockProvider {
  return new MockProvider({
    batchHandler: (listings: PreparedListing[]) =>
      listings.map((l) => yesScore(l.listing_id, reason)),
  });
}

export function maybeBatchProvider(reason = "Needs vision"): MockProvider {
  return new MockProvider({
    batchHandler: (listings: PreparedListing[]) =>
      listings.map((l) => maybeScore(l.listing_id, reason)),
  });
}

export function unhealthyProvider(): MockProvider {
  return new MockProvider({ healthy: false });
}
