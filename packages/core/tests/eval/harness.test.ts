import { describe, expect, it } from "vitest";
import { runEvalHarness } from "../../src/eval/harness.js";
import { serializeListing } from "../../src/storage/listing-snapshot.js";
import { MockProvider } from "../../src/llm/mock.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";
import { createMemoryDb } from "../helpers/db.js";
import type { ScoringResult } from "../../src/core/types.js";

const PROFILE_ID = "default";

function insertConfigRevision(db: ReturnType<typeof createMemoryDb>["db"]) {
  db.prepare(
    `INSERT INTO config_revisions (profile_id, recorded_at, content_hash, snapshot_json)
     VALUES (?, ?, ?, ?)`,
  ).run(
    PROFILE_ID,
    "2026-06-01T00:00:00.000Z",
    "test-hash",
    JSON.stringify({
      aesthetic_prompt: minimalConfig.aesthetic_prompt,
      hard_no: minimalConfig.hard_no,
      positive_signals: minimalConfig.positive_signals,
      searches: minimalConfig.searches,
      resolved_searches: {},
    }),
  );
}

function insertSeenListing(
  db: ReturnType<typeof createMemoryDb>["db"],
  id: string,
  platform: string,
  snapshot: string,
) {
  db.prepare(
    `INSERT INTO seen_listings (id, platform, profile_id, first_seen, score, listing_snapshot)
     VALUES (?, ?, ?, ?, 'PENDING', ?)`,
  ).run(id, platform, PROFILE_ID, "2026-06-01T00:00:00.000Z", snapshot);
}

function insertFeedback(
  db: ReturnType<typeof createMemoryDb>["db"],
  platform: string,
  listingId: string,
  signal: "positive" | "negative",
  recordedAt: string,
  sourceQueryId: string | null = null,
) {
  db.prepare(
    `INSERT INTO feedback (profile_id, platform, listing_id, signal, recorded_at, source_query_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(PROFILE_ID, platform, listingId, signal, recordedAt, sourceQueryId);
}

describe("eval harness", () => {
  it("replays labeled listings and builds a confusion matrix vs feedback", async () => {
    const { db } = createMemoryDb();
    insertConfigRevision(db);

    const liked = sampleListing({ id: "liked-1", title: "Liked item" });
    const disliked = sampleListing({ id: "disliked-1", title: "Disliked item" });
    insertSeenListing(db, liked.id, liked.platform, serializeListing(liked));
    insertSeenListing(db, disliked.id, disliked.platform, serializeListing(disliked));
    insertFeedback(db, liked.platform, liked.id, "positive", "2026-06-02T00:00:00.000Z", "q1");
    insertFeedback(db, disliked.platform, disliked.id, "negative", "2026-06-02T00:00:01.000Z", "q2");

    const verdicts: Record<string, ScoringResult["score"]> = {
      [`${liked.platform}:${liked.id}`]: "YES",
      [`${disliked.platform}:${disliked.id}`]: "NO",
    };
    const provider = new MockProvider({
      batchHandler: (listings) =>
        listings.map((l) => ({
          listing_id: l.listing_id,
          score: verdicts[l.listing_id],
          quality: "pass",
          value: "pass",
          aesthetic: "pass",
          size: "HIGH",
          reason: `Mock: ${verdicts[l.listing_id]}`,
        })),
    });

    const report = await runEvalHarness({
      db,
      config: minimalConfig,
      profileId: PROFILE_ID,
      provider,
    });

    expect(report.itemsEvaluated).toBe(2);
    expect(report.itemsSkipped).toBe(0);
    expect(report.confusion.truePositive).toBe(1);
    expect(report.confusion.trueNegative).toBe(1);
    expect(report.confusion.falsePositive).toBe(0);
    expect(report.confusion.falseNegative).toBe(0);
    expect(report.confusion.precision).toBe(1);
    expect(report.confusion.recall).toBe(1);

    const likedItem = report.items.find((i) => i.listingId === `${liked.platform}:${liked.id}`);
    expect(likedItem?.sourceQueryId).toBe("q1");
    expect(likedItem?.correct).toBe(true);

    db.close();
  });

  it("excludes the eval set's own labels from the few-shot prompt (no leakage)", async () => {
    const { db } = createMemoryDb();
    insertConfigRevision(db);

    const listing = sampleListing({ id: "leak-check", title: "Leak check item" });
    insertSeenListing(db, listing.id, listing.platform, serializeListing(listing));
    insertFeedback(db, listing.platform, listing.id, "positive", "2026-06-02T00:00:00.000Z");

    let observedPrompt = "";
    const provider = new MockProvider({
      batchHandler: (listings) => {
        // MockProvider doesn't expose the prompt directly to the handler,
        // so we assert indirectly via a spy provider below instead.
        return listings.map((l) => ({
          listing_id: l.listing_id,
          score: "YES" as const,
          quality: "pass" as const,
          value: "pass" as const,
          aesthetic: "pass" as const,
          size: "HIGH" as const,
          reason: "ok",
        }));
      },
    });
    const originalScoreBatch = provider.scoreBatch.bind(provider);
    provider.scoreBatch = async (listings, systemPrompt) => {
      observedPrompt = systemPrompt;
      return originalScoreBatch(listings, systemPrompt);
    };

    await runEvalHarness({ db, config: minimalConfig, profileId: PROFILE_ID, provider });

    expect(observedPrompt).not.toContain("Leak check item");

    db.close();
  });

  it("throws a clear error when no config_revisions exist for the profile", async () => {
    const { db } = createMemoryDb();
    const provider = new MockProvider();

    await expect(
      runEvalHarness({ db, config: minimalConfig, profileId: PROFILE_ID, provider }),
    ).rejects.toThrow(/No config_revisions rows found/);

    db.close();
  });
});
