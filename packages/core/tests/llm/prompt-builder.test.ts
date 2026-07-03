import { describe, expect, it, afterEach } from "vitest";
import { openDatabase, type Db } from "../../src/storage/db.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { buildSystemPrompt } from "../../src/llm/prompt-builder.js";
import { minimalConfig } from "../helpers/fixtures.js";

describe("buildSystemPrompt feedback pickup", () => {
  let db: Db;

  afterEach(() => {
    db.close();
  });

  it("omits the preferences section when no feedback rows exist", () => {
    db = openDatabase(":memory:");
    const prompt = buildSystemPrompt(minimalConfig, new FeedbackRepo(db, "default"));
    expect(prompt).not.toContain("Your actual preferences");
  });

  it("includes dashboard-recorded feedback as few-shot examples", () => {
    db = openDatabase(":memory:");
    const feedbackRepo = new FeedbackRepo(db, "default");
    const now = new Date().toISOString();

    feedbackRepo.insert(
      {
        platform: "ebay",
        listing_id: "abc123",
        signal: "positive",
        title: "Vintage Corduroy Jacket XXL",
        brand: "Helmut Lang",
        description: "Great match for dark academic aesthetic",
      },
      now,
    );
    feedbackRepo.insert(
      {
        platform: "ebay",
        listing_id: "def456",
        signal: "negative",
        title: "Graphic Tee",
        brand: "Nike",
        description: "Wrong aesthetic entirely",
      },
      now,
    );

    const prompt = buildSystemPrompt(minimalConfig, feedbackRepo);

    expect(prompt).toContain("Your actual preferences (weight these heavily)");
    expect(prompt).toContain("Items you liked:");
    expect(prompt).toContain("Vintage Corduroy Jacket XXL");
    expect(prompt).toContain("Items that were wrong:");
    expect(prompt).toContain("Graphic Tee");
  });
});
