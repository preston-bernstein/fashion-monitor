import { describe, expect, it } from "vitest";
import { reconcileBatchResults } from "../../src/llm/provider.js";
import { buildSystemPrompt } from "../../src/llm/prompt-builder.js";
import { FeedbackRepo } from "../../src/storage/repos/feedback.js";
import { minimalConfig, sampleListing } from "../helpers/fixtures.js";
import { prepareForLLM } from "../../src/core/types.js";
import { yesBatchProvider } from "../helpers/mock-provider.js";
import { createMemoryDb } from "../helpers/db.js";

describe("llm", () => {
  it("reconciles missing batch entries as MAYBE", () => {
    const prepared = [prepareForLLM(sampleListing())];
    const results = reconcileBatchResults(prepared, []);
    expect(results[0].score).toBe("MAYBE");
  });

  it("mock provider scores batch", async () => {
    const provider = yesBatchProvider("Test yes");
    const prepared = [prepareForLLM(sampleListing())];
    const results = await provider.scoreBatch(prepared, "system");
    expect(results[0].score).toBe("YES");
    expect(results[0].reason).toBe("Test yes");
  });

  it("builds prompt with feedback examples", () => {
    const { db } = createMemoryDb();
    const feedback = new FeedbackRepo(db, "default");
    feedback.insert(
      {
        platform: "ebay",
        listing_id: "1",
        signal: "positive",
        title: "Corduroy jacket",
        brand: "EG",
      },
      new Date().toISOString(),
    );
    const prompt = buildSystemPrompt(minimalConfig, feedback);
    expect(prompt).toContain("Corduroy jacket");
    expect(prompt).toContain("QUALITY means");
    expect(prompt).toContain(minimalConfig.aesthetic_prompt.trim());
    db.close();
  });
});
