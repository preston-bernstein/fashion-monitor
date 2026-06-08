import { afterEach, describe, expect, it, vi } from "vitest";
import { processFeedbackUpdate } from "../../src/alerts/feedback-handler.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { AlertLogRepo } from "../../src/storage/repos/alert-log.js";
import { sampleListing } from "../helpers/fixtures.js";
import { createMemoryDb } from "../helpers/db.js";

describe("feedback handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records positive feedback and answers callback", async () => {
    const { db } = createMemoryDb();
    const feedbackRepo = new FeedbackRepo(db, "default");
    const alertLogRepo = new AlertLogRepo(db, "default");
    const listing = sampleListing();
    const now = new Date().toISOString();

    alertLogRepo.insert(
      listing,
      {
        listing_id: "ebay:abc123",
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Great find",
      },
      now,
    );

    const answerCallback = vi.fn().mockResolvedValue(undefined);

    const handled = processFeedbackUpdate(
      {
        update_id: 1,
        callback_query: {
          id: "cb-1",
          data: "fb:ebay:abc123:positive",
          message: { caption: "Helmut Lang — Wool Crewneck" },
        },
      },
      { feedbackRepo, alertLogRepo, answerCallback },
    );

    expect(handled).toBe(true);
    expect(answerCallback).toHaveBeenCalledWith("cb-1");

    const rows = db
      .prepare(
        `SELECT signal, title, price, description FROM feedback WHERE profile_id = 'default'`,
      )
      .all() as Array<{
      signal: string;
      title: string | null;
      price: number | null;
      description: string | null;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].signal).toBe("positive");
    expect(rows[0].title).toContain("Helmut Lang");
    expect(rows[0].price).toBe(85);
    expect(rows[0].description).toBe("Great find");

    db.close();
  });

  it("ignores invalid callback data", () => {
    const { db } = createMemoryDb();
    const feedbackRepo = new FeedbackRepo(db, "default");
    const alertLogRepo = new AlertLogRepo(db, "default");
    const answerCallback = vi.fn();

    const handled = processFeedbackUpdate(
      {
        update_id: 2,
        callback_query: { id: "cb-2", data: "not-feedback" },
      },
      { feedbackRepo, alertLogRepo, answerCallback },
    );

    expect(handled).toBe(false);
    expect(answerCallback).not.toHaveBeenCalled();
    db.close();
  });
});
