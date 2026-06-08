import { describe, expect, it } from "vitest";
import { SeenListingsRepo } from "../../src/storage/repos/seen-listings.js";
import { RunsRepo } from "../../src/storage/repos/runs.js";
import { sampleListing } from "../helpers/fixtures.js";
import { createMemoryDb } from "../helpers/db.js";

describe("storage pruning", () => {
  it("prunes old seen_listings and runs", () => {
    const { db } = createMemoryDb();
    const seenRepo = new SeenListingsRepo(db, "default");
    const runsRepo = new RunsRepo(db);

    const oldDate = "2024-01-01T00:00:00.000Z";
    const recentDate = "2025-06-01T00:00:00.000Z";
    const now = new Date("2025-06-07T00:00:00.000Z");

    seenRepo.markSeen(sampleListing({ id: "old" }), "NO", oldDate);
    seenRepo.markSeen(sampleListing({ id: "recent" }), "NO", recentDate);

    const seenPruned = seenRepo.pruneOlderThan(90, now);
    expect(seenPruned).toBe(1);

    const remaining = db
      .prepare(`SELECT id FROM seen_listings WHERE profile_id = 'default'`)
      .all() as Array<{ id: string }>;
    expect(remaining.map((r) => r.id)).toEqual(["recent"]);

    db.prepare(`INSERT INTO runs (started_at) VALUES (?)`).run(oldDate);
    db.prepare(`INSERT INTO runs (started_at) VALUES (?)`).run(recentDate);

    const runsPruned = runsRepo.pruneOlderThan(30, now);
    expect(runsPruned).toBe(1);

    const runRows = db.prepare(`SELECT started_at FROM runs`).all() as Array<{
      started_at: string;
    }>;
    expect(runRows).toHaveLength(1);
    expect(runRows[0].started_at).toBe(recentDate);

    db.close();
  });
});
