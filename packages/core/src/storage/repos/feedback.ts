import type { FeedbackRow, Platform } from "../../core/types.js";
import type { Db } from "../db.js";

export interface FeedbackInsert {
  platform: Platform;
  listing_id: string;
  signal: "positive" | "negative";
  title?: string | null;
  brand?: string | null;
  description?: string | null;
  image_url?: string | null;
  price?: number | null;
  condition?: string | null;
  fabric_signals?: string | null;
  source_query_id?: string | null;
}

export class FeedbackRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  insert(row: FeedbackInsert, recordedAt: string): void {
    this.db
      .prepare(
        `INSERT INTO feedback (
          profile_id, platform, listing_id, signal, title, brand, description,
          image_url, price, condition, fabric_signals, recorded_at, source_query_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.profileId,
        row.platform,
        row.listing_id,
        row.signal,
        row.title ?? null,
        row.brand ?? null,
        row.description ?? null,
        row.image_url ?? null,
        row.price ?? null,
        row.condition ?? null,
        row.fabric_signals ?? null,
        recordedAt,
        row.source_query_id ?? null,
      );
  }

  fetchRecent(signal: "positive" | "negative", limit: number): FeedbackRow[] {
    return this.db
      .prepare(
        `SELECT * FROM feedback
         WHERE profile_id = ? AND signal = ?
         ORDER BY recorded_at DESC LIMIT ?`,
      )
      .all(this.profileId, signal, limit) as FeedbackRow[];
  }
}
