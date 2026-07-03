import type { Db } from "./db.js";

/**
 * Every profile_id-scoped table, in an order that doesn't matter (no FK
 * constraints enforce ordering in this schema — see change-control's note on
 * migrations having no applied-tracking table, same "no FK enforcement"
 * posture). `profiles` itself is deleted last. `users` is excluded — it's
 * global identity, not profile-owned; a deleted profile's members keep their
 * account and simply lose this one membership row.
 */
const PROFILE_SCOPED_TABLES = [
  "search_group_images",
  "listing_images",
  "scrape_query_runs",
  "scrape_queries",
  "search_groups",
  "seen_listings",
  "alert_log",
  "feedback",
  "config_revisions",
  "profile_settings",
  "profile_secrets",
  "integration_events",
  "runs",
  "audit_log",
  "memberships",
  "sessions",
  "invites",
] as const;

export interface ProfileDeletionResult {
  profileId: string;
  rowsDeleted: number;
}

/**
 * Cascades every profile_id-scoped row for `profileId`, then the profile row
 * itself, in one transaction. The caller is responsible for the "final audit
 * record" (see self-service-onboarding.md Phase 2 item 3) — recorded
 * elsewhere since this profile's own audit_log is part of what's deleted.
 */
export function deleteProfileCascade(db: Db, profileId: string): ProfileDeletionResult {
  const run = db.transaction((id: string) => {
    let rowsDeleted = 0;
    for (const table of PROFILE_SCOPED_TABLES) {
      const result = db.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(id);
      rowsDeleted += result.changes;
    }
    const profileResult = db.prepare(`DELETE FROM profiles WHERE id = ?`).run(id);
    rowsDeleted += profileResult.changes;
    return rowsDeleted;
  });

  return { profileId, rowsDeleted: run(profileId) };
}
