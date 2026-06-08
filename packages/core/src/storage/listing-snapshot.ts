import type { Listing } from "../core/types.js";
import { listingKey, PLATFORMS } from "../core/types.js";

interface StoredListing extends Omit<Listing, "listedAt"> {
  listedAt: string | null;
}

export function serializeListing(listing: Listing): string {
  const stored: StoredListing = {
    ...listing,
    listedAt: listing.listedAt?.toISOString() ?? null,
    raw: {},
  };
  return JSON.stringify(stored);
}

export function deserializeListing(json: string): Listing {
  const stored = JSON.parse(json) as StoredListing;
  if (!PLATFORMS.includes(stored.platform)) {
    throw new Error(`Invalid platform in listing snapshot: ${stored.platform}`);
  }
  return {
    ...stored,
    listedAt: stored.listedAt ? new Date(stored.listedAt) : null,
    raw: {},
  };
}

export function mergeListings(primary: Listing[], secondary: Listing[]): Listing[] {
  const byKey = new Map<string, Listing>();
  for (const listing of primary) {
    byKey.set(listingKey(listing.platform, listing.id), listing);
  }
  for (const listing of secondary) {
    byKey.set(listingKey(listing.platform, listing.id), listing);
  }
  return [...byKey.values()];
}
