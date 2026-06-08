import type { Listing, Platform } from "../../core/types.js";
import { extractListingImages } from "../../images/extract.js";
import { hashImageUrl } from "../../images/url-hash.js";
import type { Db } from "../db.js";

export interface ListingImageRow {
  platform: Platform;
  listing_id: string;
  url_hash: string;
  url: string;
  position: number;
  width: number | null;
  height: number | null;
  first_seen: string;
  updated_at: string;
}

export class ListingImagesRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  upsertFromListing(listing: Listing, now: string): void {
    const images = extractListingImages(listing);
    if (images.length === 0) return;

    const stmt = this.db.prepare(
      `INSERT INTO listing_images (
         profile_id, platform, listing_id, url_hash, url, position, width, height, first_seen, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(profile_id, platform, listing_id, url_hash) DO UPDATE SET
         position = excluded.position,
         width = COALESCE(excluded.width, listing_images.width),
         height = COALESCE(excluded.height, listing_images.height),
         updated_at = excluded.updated_at`,
    );

    for (const image of images) {
      stmt.run(
        this.profileId,
        listing.platform,
        listing.id,
        hashImageUrl(image.url),
        image.url,
        image.position,
        image.width ?? null,
        image.height ?? null,
        now,
        now,
      );
    }
  }

  listForListing(platform: Platform, listingId: string): ListingImageRow[] {
    return this.db
      .prepare(
        `SELECT platform, listing_id, url_hash, url, position, width, height, first_seen, updated_at
         FROM listing_images
         WHERE profile_id = ? AND platform = ? AND listing_id = ?
         ORDER BY position`,
      )
      .all(this.profileId, platform, listingId) as ListingImageRow[];
  }

  getPrimaryUrl(platform: Platform, listingId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT url FROM listing_images
         WHERE profile_id = ? AND platform = ? AND listing_id = ?
         ORDER BY position LIMIT 1`,
      )
      .get(this.profileId, platform, listingId) as { url: string } | undefined;
    return row?.url ?? null;
  }

  findLatestForGroup(
    groupId: string,
    limit = 5,
  ): Array<{ platform: Platform; listing_id: string; url: string; score: string | null }> {
    return this.db
      .prepare(
        `SELECT li.platform, li.listing_id, li.url, sl.score
         FROM listing_images li
         JOIN seen_listings sl
           ON sl.profile_id = li.profile_id
          AND sl.platform = li.platform
          AND sl.id = li.listing_id
         WHERE li.profile_id = ?
           AND li.position = 0
           AND sl.source_query_id = ?
         ORDER BY sl.first_seen DESC
         LIMIT ?`,
      )
      .all(this.profileId, groupId, limit) as Array<{
      platform: Platform;
      listing_id: string;
      url: string;
      score: string | null;
    }>;
  }
}
