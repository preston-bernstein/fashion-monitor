import type { Platform } from "../../core/types.js";
import { isAllowedCuratedImageUrl, isAllowedImageUrl } from "../../images/allowlist.js";
import type { Db } from "../db.js";
import { ListingImagesRepo } from "./listing-images.js";

export type SearchGroupImageSource = "listing" | "url";

export interface SearchGroupImageRow {
  id: number;
  profile_id: string;
  group_id: string;
  source: SearchGroupImageSource;
  listing_platform: Platform | null;
  listing_id: string | null;
  url: string;
  sort_order: number;
  caption: string | null;
  created_at: string;
  updated_at: string;
}

export class SearchGroupImagesRepo {
  constructor(
    private readonly db: Db,
    private readonly profileId: string,
  ) {}

  listForGroup(groupId: string): SearchGroupImageRow[] {
    return this.db
      .prepare(
        `SELECT id, profile_id, group_id, source, listing_platform, listing_id, url,
                sort_order, caption, created_at, updated_at
         FROM search_group_images
         WHERE profile_id = ? AND group_id = ?
         ORDER BY sort_order, id`,
      )
      .all(this.profileId, groupId) as SearchGroupImageRow[];
  }

  getById(id: number): SearchGroupImageRow | undefined {
    return this.db
      .prepare(
        `SELECT id, profile_id, group_id, source, listing_platform, listing_id, url,
                sort_order, caption, created_at, updated_at
         FROM search_group_images
         WHERE profile_id = ? AND id = ?`,
      )
      .get(this.profileId, id) as SearchGroupImageRow | undefined;
  }

  addFromListing(
    groupId: string,
    platform: Platform,
    listingId: string,
    now: string,
    caption?: string | null,
  ): SearchGroupImageRow {
    const listingImages = new ListingImagesRepo(this.db, this.profileId);
    const url = listingImages.getPrimaryUrl(platform, listingId);
    if (!url) {
      throw new Error("listing_has_no_images");
    }
    if (!isAllowedImageUrl(platform, url)) {
      throw new Error("image_url_not_allowed");
    }

    const sortOrder = this.nextSortOrder(groupId);
    const result = this.db
      .prepare(
        `INSERT INTO search_group_images (
           profile_id, group_id, source, listing_platform, listing_id, url, sort_order, caption, created_at, updated_at
         ) VALUES (?, ?, 'listing', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.profileId, groupId, platform, listingId, url, sortOrder, caption ?? null, now, now);

    return this.getById(Number(result.lastInsertRowid))!;
  }

  addFromUrl(
    groupId: string,
    url: string,
    now: string,
    caption?: string | null,
  ): SearchGroupImageRow {
    if (!isAllowedCuratedImageUrl(url)) {
      throw new Error("image_url_not_allowed");
    }

    const sortOrder = this.nextSortOrder(groupId);
    const result = this.db
      .prepare(
        `INSERT INTO search_group_images (
           profile_id, group_id, source, listing_platform, listing_id, url, sort_order, caption, created_at, updated_at
         ) VALUES (?, ?, 'url', NULL, NULL, ?, ?, ?, ?, ?)`,
      )
      .run(this.profileId, groupId, url, sortOrder, caption ?? null, now, now);

    return this.getById(Number(result.lastInsertRowid))!;
  }

  remove(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM search_group_images WHERE profile_id = ? AND id = ?`)
      .run(this.profileId, id);
    return result.changes > 0;
  }

  private nextSortOrder(groupId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM search_group_images WHERE profile_id = ? AND group_id = ?`,
      )
      .get(this.profileId, groupId) as { next_order: number };
    return row.next_order;
  }
}
