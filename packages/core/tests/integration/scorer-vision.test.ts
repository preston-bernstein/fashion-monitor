import { describe, expect, it, vi } from "vitest";
import { scoreListings, filterAlertable } from "../../src/pipeline/scorer.js";
import { maybeBatchProvider } from "../helpers/mock-provider.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { MockProvider } from "../../src/llm/mock.js";
import { createMemoryDb } from "../helpers/db.js";

describe("scorer two-pass vision", () => {
  it("upgrades MAYBE to YES via vision when image present", async () => {
    const visionSpy = vi.fn();
    const provider = new MockProvider({
      batchHandler: (listings) =>
        listings.map((l) => ({
          listing_id: l.listing_id,
          score: "MAYBE" as const,
          quality: "uncertain" as const,
          value: "uncertain" as const,
          aesthetic: "uncertain" as const,
          size: "UNCERTAIN" as const,
          reason: "Needs vision",
        })),
      imageHandler: (listing) => {
        visionSpy(listing.listing_id);
        return {
          listing_id: listing.listing_id,
          score: "YES",
          quality: "pass",
          value: "pass",
          aesthetic: "pass",
          size: "HIGH",
          reason: "Vision confirmed",
        };
      },
    });

    const listing = sampleListing({ imageUrl: "https://example.com/photo.jpg" });
    const { db } = createMemoryDb();
    const feedbackRepo = new FeedbackRepo(db, "default");

    const result = await scoreListings([listing], minimalConfig, provider, feedbackRepo);

    expect(visionSpy).toHaveBeenCalledOnce();
    expect(result.yes).toHaveLength(1);
    expect(result.maybe).toHaveLength(0);
    expect(result.yes[0].reason).toBe("Vision confirmed");

    const alertable = filterAlertable(result.scored);
    expect(alertable).toHaveLength(1);
    expect(alertable[0].result.score).toBe("YES");

    db.close();
  });

  it("skips vision when MAYBE listing has no image", async () => {
    const provider = maybeBatchProvider("No image path");

    const listing = sampleListing({ imageUrl: undefined });
    const { db } = createMemoryDb();
    const feedbackRepo = new FeedbackRepo(db, "default");

    const result = await scoreListings([listing], minimalConfig, provider, feedbackRepo);

    expect(result.maybe).toHaveLength(1);
    db.close();
  });
});
