import type { Listing, Platform, ScoreVerdict } from "../../core/types.js";
import { deserializeListing, serializeListing } from "../listing-snapshot.js";
import type { Db } from "../db.js";
import { pruneOlderThan as pruneRowsOlderThan } from "../prune.js";

export interface SeenListingRow {
  id: string;
  platform: Platform;
  profile_id: string;
  first_seen: string;
  score: ScoreVerdict | null;
  alerted_at: string | null;
  last_price: number | null;
  listing_snapshot: string | null;
}

export class SeenListingsRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  findExisting(platform: Platform, id: string): SeenListingRow | undefined {
    return this.db
      .prepare(
        `SELECT id, platform, profile_id, first_seen, score, alerted_at, last_price, listing_snapshot
         FROM seen_listings WHERE platform = ? AND id = ? AND profile_id = ?`,
      )
      .get(platform, id, this.profileId) as SeenListingRow | undefined;
  }

  hasFinalScore(platform: Platform, id: string): boolean {
    const row = this.findExisting(platform, id);
    if (!row?.score) return false;
    return row.score === "YES" || row.score === "MAYBE" || row.score === "NO";
  }

  markSeen(listing: Listing, score: ScoreVerdict | null, now: string): void {
    const existing = this.findExisting(listing.platform, listing.id);
    if (existing) {
      this.updateLastPrice(listing);

      if (!existing.score || existing.score === "PENDING") {
        if (score && score !== "PENDING") {
          this.setScore(listing.platform, listing.id, score);
        }
      }
      return;
    }

    this.insertSeen(listing, now, score, null);
  }

  markPending(listing: Listing, now: string): void {
    const snapshot = serializeListing(listing);
    const existing = this.findExisting(listing.platform, listing.id);

    if (existing) {
      this.db
        .prepare(
          `UPDATE seen_listings
           SET score = 'PENDING', last_price = ?, listing_snapshot = ?,
               source_query_id = COALESCE(?, source_query_id)
           WHERE platform = ? AND id = ? AND profile_id = ?`,
        )
        .run(
          listing.price,
          snapshot,
          listing.sourceQueryId ?? null,
          listing.platform,
          listing.id,
          this.profileId,
        );
      return;
    }

    this.insertSeen(listing, now, "PENDING", snapshot);
  }

  setScore(platform: Platform, id: string, score: ScoreVerdict): void {
    this.db
      .prepare(
        `UPDATE seen_listings
         SET score = ?, listing_snapshot = NULL
         WHERE platform = ? AND id = ? AND profile_id = ?`,
      )
      .run(score, platform, id, this.profileId);
  }

  recordScore(listing: Listing, score: ScoreVerdict, now: string): void {
    const existing = this.findExisting(listing.platform, listing.id);
    if (existing) {
      this.setScore(listing.platform, listing.id, score);
      this.updateLastPrice(listing);
      return;
    }

    this.insertSeen(listing, now, score, null);
  }

  markAlerted(platform: Platform, id: string, alertedAt: string): void {
    this.db
      .prepare(
        `UPDATE seen_listings SET alerted_at = ? WHERE platform = ? AND id = ? AND profile_id = ?`,
      )
      .run(alertedAt, platform, id, this.profileId);
  }

  fetchPendingListings(): Listing[] {
    const rows = this.db
      .prepare(
        `SELECT listing_snapshot FROM seen_listings
         WHERE profile_id = ? AND score = 'PENDING' AND listing_snapshot IS NOT NULL`,
      )
      .all(this.profileId) as Array<{ listing_snapshot: string }>;

    const listings: Listing[] = [];
    for (const row of rows) {
      try {
        listings.push(deserializeListing(row.listing_snapshot));
      } catch {
        // skip corrupt snapshots
      }
    }
    return listings;
  }

  pruneOlderThan(days: number, now: Date): number {
    return pruneRowsOlderThan(
      this.db,
      `DELETE FROM seen_listings WHERE first_seen < ? AND profile_id = ?`,
      [this.profileId],
      days,
      now,
    );
  }

  private insertSeen(
    listing: Listing,
    now: string,
    score: ScoreVerdict | null,
    snapshot: string | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO seen_listings (
           id, platform, profile_id, first_seen, score, last_price, listing_snapshot, source_query_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        listing.id,
        listing.platform,
        this.profileId,
        now,
        score,
        listing.price,
        snapshot,
        listing.sourceQueryId ?? null,
      );
  }

  private updateLastPrice(listing: Listing): void {
    this.db
      .prepare(
        `UPDATE seen_listings SET last_price = ?, source_query_id = COALESCE(?, source_query_id)
         WHERE platform = ? AND id = ? AND profile_id = ?`,
      )
      .run(
        listing.price,
        listing.sourceQueryId ?? null,
        listing.platform,
        listing.id,
        this.profileId,
      );
  }
}
