import type { PreparedListing, ScoringResult } from "../core/types.js";
import { type LLMProvider, maybeResult, reconcileBatchResults } from "./provider.js";

export interface MockProviderOptions {
  batchHandler?: (listings: PreparedListing[]) => ScoringResult[];
  imageHandler?: (listing: PreparedListing) => ScoringResult;
  healthy?: boolean;
}

export class MockProvider implements LLMProvider {
  private readonly batchHandler: (listings: PreparedListing[]) => ScoringResult[];
  private readonly imageHandler: (listing: PreparedListing) => ScoringResult;
  private readonly healthy: boolean;

  constructor(options: MockProviderOptions = {}) {
    this.batchHandler =
      options.batchHandler ??
      ((listings) =>
        listings.map((l) => ({
          listing_id: l.listing_id,
          score: "MAYBE" as const,
          quality: "uncertain" as const,
          value: "uncertain" as const,
          aesthetic: "uncertain" as const,
          size: "UNCERTAIN" as const,
          reason: "Mock provider default",
        })));
    this.imageHandler =
      options.imageHandler ??
      ((listing) => ({
        listing_id: listing.listing_id,
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Mock vision pass",
      }));
    this.healthy = options.healthy ?? true;
  }

  async scoreBatch(listings: PreparedListing[], _systemPrompt: string): Promise<ScoringResult[]> {
    return reconcileBatchResults(listings, this.batchHandler(listings));
  }

  async scoreWithImage(listing: PreparedListing, _systemPrompt: string): Promise<ScoringResult> {
    return this.imageHandler(listing);
  }

  async healthCheck(): Promise<boolean> {
    return this.healthy;
  }
}

export function createMockProvider(options?: MockProviderOptions): LLMProvider {
  return new MockProvider(options);
}

export function createBrokenMockProvider(): LLMProvider {
  return new MockProvider({
    healthy: false,
    batchHandler: (listings) => listings.map((l) => maybeResult(l.listing_id, "Provider down")),
  });
}
