import { dedupeByKey } from "../lib/batch.js";
import { listingKey, type Listing } from "../core/types.js";
import type { SeenListingsRepo } from "../storage/repos/seen-listings.js";

export function dedupeInMemory(listings: Listing[]): Listing[] {
  return dedupeByKey(listings, (l) => listingKey(l.platform, l.id));
}

export function filterUnscored(
  listings: Listing[],
  repo: SeenListingsRepo,
): { newListings: Listing[]; skipped: number } {
  let skipped = 0;
  const newListings: Listing[] = [];

  for (const listing of listings) {
    if (repo.hasFinalScore(listing.platform, listing.id)) {
      skipped++;
      continue;
    }
    newListings.push(listing);
  }

  return { newListings, skipped };
}

export function dedupePipeline(
  listings: Listing[],
  repo: SeenListingsRepo,
): { listings: Listing[]; inMemoryDeduped: number; dbSkipped: number } {
  const before = listings.length;
  const deduped = dedupeInMemory(listings);
  const inMemoryDeduped = before - deduped.length;
  const { newListings, skipped } = filterUnscored(deduped, repo);
  return { listings: newListings, inMemoryDeduped, dbSkipped: skipped };
}
