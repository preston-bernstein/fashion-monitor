import { describe, expect, it } from "vitest";
import { buildFeedbackInsert } from "../../src/alerts/feedback-record.js";
import { AlertLogRepo } from "../../src/storage/repos/alert-log.js";
import { sampleListing } from "../helpers/fixtures.js";
import { createMemoryDb } from "../helpers/db.js";

describe("feedback record", () => {
  it("enriches feedback from alert_log", () => {
    const { db } = createMemoryDb();
    const alertLog = new AlertLogRepo(db, "default");
    const listing = sampleListing();

    alertLog.insert(
      listing,
      {
        listing_id: "ebay:abc123",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Dark linen, Cave-adjacent",
      },
      new Date().toISOString(),
    );

    const record = buildFeedbackInsert(
      { platform: "ebay", listing_id: "abc123", signal: "positive" },
      alertLog,
    );

    expect(record.title).toBe(listing.title);
    expect(record.brand).toBe(listing.brand);
    expect(record.price).toBe(listing.price);
    expect(record.description).toContain("Cave-adjacent");
    db.close();
  });
});
