import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../helpers/db.js";
import { sampleListing } from "../helpers/fixtures.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { AlertLogRepo } from "../../src/storage/repos/alert-log.js";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { SearchGroupsRepo } from "../../src/storage/repos/search-groups.js";

/**
 * Multi-profile-campaign Phase 2 isolation audit. Covers every profile-scoped
 * repo except RunsRepo (still unscoped pending Phase 1, tracked separately)
 * and SessionsRepo (intentionally user-scoped, not profile-scoped — a
 * session's `profile_id` is the user's active-profile context, not a data
 * boundary; see fashion-monitor-multi-profile-campaign Phase 2 notes).
 */
describe("profile isolation (multi-profile Phase 2 audit)", () => {
  it("FeedbackRepo: rows written for p1 are invisible via a p2-scoped instance", () => {
    const { db } = createMemoryDb();
    const p1 = new FeedbackRepo(db, "p1");
    const p2 = new FeedbackRepo(db, "p2");

    p1.insert(
      { platform: "ebay", listing_id: "abc123", signal: "positive", title: "p1 item" },
      "2026-01-01T00:00:00.000Z",
    );

    expect(p1.fetchRecent("positive", 10)).toHaveLength(1);
    expect(p2.fetchRecent("positive", 10)).toHaveLength(0);

    db.close();
  });

  it("AlertLogRepo: a p1 alert is not findable via a p2-scoped instance", () => {
    const { db } = createMemoryDb();
    const p1 = new AlertLogRepo(db, "p1");
    const p2 = new AlertLogRepo(db, "p2");
    const listing = sampleListing();

    p1.insert(
      listing,
      {
        listing_id: `${listing.platform}:${listing.id}`,
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "great",
      },
      "2026-01-01T00:00:00.000Z",
    );

    expect(p1.findLatest(listing.platform, listing.id)).toBeDefined();
    expect(p2.findLatest(listing.platform, listing.id)).toBeUndefined();

    db.close();
  });

  it("SeenListingsRepo: a listing seen by p1 is not seen by p2 (same platform+id)", () => {
    const { db } = createMemoryDb();
    const p1 = new SeenListingsRepo(db, "p1");
    const p2 = new SeenListingsRepo(db, "p2");
    const listing = sampleListing();

    p1.markSeen(listing, "YES", "2026-01-01T00:00:00.000Z");

    expect(p1.findExisting(listing.platform, listing.id)).toBeDefined();
    expect(p2.findExisting(listing.platform, listing.id)).toBeUndefined();

    db.close();
  });

  it("SearchGroupsRepo: a Monitor id may be reused across profiles without collision or leakage", () => {
    const { db } = createMemoryDb();
    const p1 = new SearchGroupsRepo(db, "p1");
    const p2 = new SearchGroupsRepo(db, "p2");
    const ts = "2026-01-01T00:00:00.000Z";

    p1.createGroup(
      {
        id: "shared-monitor-id",
        query_text: "p1's query",
        platforms: ["ebay"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      ts,
    );
    // Same id, different profile — composite PRIMARY KEY (id, profile_id)
    // must allow this without clobbering p1's row.
    p2.createGroup(
      {
        id: "shared-monitor-id",
        query_text: "p2's query",
        platforms: ["depop"],
        query_overrides: {},
        enabled: true,
        status: "active",
        note: null,
      },
      ts,
    );

    expect(p1.getGroup("shared-monitor-id")?.query_text).toBe("p1's query");
    expect(p2.getGroup("shared-monitor-id")?.query_text).toBe("p2's query");
    expect(p1.listGroups()).toHaveLength(1);
    expect(p2.listGroups()).toHaveLength(1);

    db.close();
  });
});
