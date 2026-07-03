import { describe, expect, it, vi, beforeEach } from "vitest";

const logSpy = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../src/lib/logging.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/logging.js")>();
  return { ...actual, createLogger: () => ({ ...logSpy, child: () => logSpy }) };
});

import { scoreListings, filterAlertable } from "../../src/pipeline/scorer.js";
import { maybeBatchProvider } from "../helpers/mock-provider.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { MockProvider } from "../../src/llm/mock.js";
import { createMemoryDb } from "../helpers/db.js";

beforeEach(() => {
  logSpy.info.mockClear();
  logSpy.debug.mockClear();
  logSpy.warn.mockClear();
  logSpy.error.mockClear();
});

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

  it("logs the text->vision verdict transition (F3 flip instrumentation)", async () => {
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
      imageHandler: (listing) => ({
        listing_id: listing.listing_id,
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Vision confirmed",
      }),
    });

    const listing = sampleListing({ imageUrl: "https://example.com/photo.jpg" });
    const { db } = createMemoryDb();
    const feedbackRepo = new FeedbackRepo(db, "default");

    await scoreListings([listing], minimalConfig, provider, feedbackRepo);

    const flipCall = logSpy.info.mock.calls.find(
      ([event]) => event === "pipeline.scorer.vision.flip",
    );
    expect(flipCall).toBeTruthy();
    expect(flipCall![1]).toMatchObject({
      listing_id: `${listing.platform}:${listing.id}`,
      text_verdict: "MAYBE",
      vision_verdict: "YES",
      flipped: true,
    });

    db.close();
  });

  it("marks flipped:false when vision agrees with the text verdict", async () => {
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
      imageHandler: (listing) => ({
        listing_id: listing.listing_id,
        score: "MAYBE",
        quality: "uncertain",
        value: "uncertain",
        aesthetic: "uncertain",
        size: "UNCERTAIN",
        reason: "Still unsure",
      }),
    });

    const listing = sampleListing({ imageUrl: "https://example.com/photo.jpg" });
    const { db } = createMemoryDb();
    const feedbackRepo = new FeedbackRepo(db, "default");

    await scoreListings([listing], minimalConfig, provider, feedbackRepo);

    const flipCall = logSpy.info.mock.calls.find(
      ([event]) => event === "pipeline.scorer.vision.flip",
    );
    expect(flipCall).toBeTruthy();
    expect(flipCall![1]).toMatchObject({
      text_verdict: "MAYBE",
      vision_verdict: "MAYBE",
      flipped: false,
    });

    db.close();
  });
});
