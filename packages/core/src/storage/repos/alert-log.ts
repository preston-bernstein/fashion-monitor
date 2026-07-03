import type { Listing, ScoringResult } from "../../core/types.js";
import type { Db } from "../db.js";

export class AlertLogRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  findLatest(
    platform: string,
    listingId: string,
  ):
    | {
        title: string | null;
        brand: string | null;
        price: number | null;
        url: string | null;
        score: string | null;
        llm_reason: string | null;
        source_query_id: string | null;
      }
    | undefined {
    return this.db
      .prepare(
        `SELECT title, brand, price, url, score, llm_reason, source_query_id FROM alert_log
         WHERE profile_id = ? AND platform = ? AND listing_id = ?
         ORDER BY alerted_at DESC LIMIT 1`,
      )
      .get(this.profileId, platform, listingId) as
      | {
          title: string | null;
          brand: string | null;
          price: number | null;
          url: string | null;
          score: string | null;
          llm_reason: string | null;
          source_query_id: string | null;
        }
      | undefined;
  }

  latestAlertedAt(): string | null {
    const row = this.db
      .prepare(
        `SELECT alerted_at FROM alert_log WHERE profile_id = ? ORDER BY alerted_at DESC LIMIT 1`,
      )
      .get(this.profileId) as { alerted_at: string } | undefined;
    return row?.alerted_at ?? null;
  }

  insert(listing: Listing, result: ScoringResult, alertedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO alert_log (
          profile_id, platform, listing_id, title, brand, price, currency,
          url, score, llm_reason, alerted_at, source_query_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.profileId,
        listing.platform,
        listing.id,
        listing.title,
        listing.brand,
        listing.price,
        listing.currency,
        listing.url,
        result.score,
        result.reason,
        alertedAt,
        listing.sourceQueryId ?? null,
      );
  }
}
