import type { Platform, ScoreVerdict } from "@fm/shared/platforms.js";

export { PLATFORMS, type Platform, type ScoreVerdict } from "@fm/shared/platforms.js";

export type DimensionVerdict = "pass" | "fail" | "uncertain";

export type SizeVerdict = "HIGH" | "UNCERTAIN" | "UNLIKELY";

export type PriceCategory = "tops" | "pants" | "outerwear" | "default";

export interface Listing {
  id: string;
  platform: Platform;
  title: string;
  description: string;
  price: number;
  currency: string;
  size: string;
  brand: string | null;
  url: string;
  imageUrl: string | null;
  listedAt: Date | null;
  condition: string | null;
  raw: Record<string, unknown>;
  sourceQueryId?: string;
}

export interface PreparedListing {
  listing_id: string;
  title: string;
  brand: string;
  description: string;
  price: number;
  condition: string | null;
  size: string;
  image_url?: string | null;
}

export interface ScoringResult {
  listing_id: string;
  score: Exclude<ScoreVerdict, "PENDING">;
  quality: DimensionVerdict;
  value: DimensionVerdict;
  aesthetic: DimensionVerdict;
  size: SizeVerdict;
  reason: string;
}

export interface ScoredListing {
  listing: Listing;
  result: ScoringResult;
}

export interface RunStats {
  listingsFound: number;
  listingsNew: number;
  scoredYes: number;
  scoredMaybe: number;
  scoredNo: number;
  alertsSent: number;
  prefilterRejected: number;
  errors: string[];
}

export interface FeedbackRow {
  id: number;
  profile_id: string;
  platform: Platform;
  listing_id: string;
  signal: "positive" | "negative";
  title: string | null;
  brand: string | null;
  description: string | null;
  image_url: string | null;
  price: number | null;
  condition: string | null;
  fabric_signals: string | null;
  recorded_at: string;
  source_query_id?: string | null;
}

export function listingKey(platform: Platform, id: string): string {
  return `${platform}:${id}`;
}

export function prepareForLLM(listing: Listing): PreparedListing {
  const desc = listing.description ?? "";
  return {
    listing_id: listingKey(listing.platform, listing.id),
    title: listing.title,
    brand: listing.brand ?? "unknown",
    description: desc.length > 500 ? `${desc.slice(0, 500)}...` : desc,
    price: listing.price,
    condition: listing.condition,
    size: listing.size,
    image_url: listing.imageUrl,
  };
}
