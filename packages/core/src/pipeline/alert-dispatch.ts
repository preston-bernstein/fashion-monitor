import type { ScoredListing } from "../core/types.js";
import type { AlertLogRepo } from "../storage/repos/alert-log.js";
import type { SeenListingsRepo } from "../storage/repos/seen-listings.js";

export function recordAlertSent(
  scored: ScoredListing,
  alertLogRepo: AlertLogRepo,
  seenRepo: SeenListingsRepo,
  alertedAt: string,
): void {
  alertLogRepo.insert(scored.listing, scored.result, alertedAt);
  seenRepo.markAlerted(scored.listing.platform, scored.listing.id, alertedAt);
}

export function recordAlertsSent(
  scored: ScoredListing[],
  alertLogRepo: AlertLogRepo,
  seenRepo: SeenListingsRepo,
  alertedAt: string,
): void {
  for (const item of scored) {
    recordAlertSent(item, alertLogRepo, seenRepo, alertedAt);
  }
}
