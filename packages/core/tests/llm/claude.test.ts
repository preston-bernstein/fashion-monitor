import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { prepareForLLM } from "../../src/core/types.js";
import { sampleListing } from "../helpers/fixtures.js";
import { minimalConfig } from "../helpers/fixtures.js";

const create = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create };
  },
}));

const { ClaudeProvider } = await import("../../src/llm/claude.js");

function textResponse(json: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(json) }] };
}

describe("ClaudeProvider", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    create.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("throws without ANTHROPIC_API_KEY", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new ClaudeProvider(minimalConfig.llm)).toThrow(
      "ANTHROPIC_API_KEY required for claude provider",
    );
  });

  it("healthCheck reflects whether the API key is set", async () => {
    const provider = new ClaudeProvider(minimalConfig.llm);
    await expect(provider.healthCheck()).resolves.toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it("scoreBatch returns [] without calling the API for an empty list", async () => {
    const provider = new ClaudeProvider(minimalConfig.llm);
    const results = await provider.scoreBatch([], "system");
    expect(results).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("scoreBatch parses a valid batch response and reconciles by listing id", async () => {
    const prepared = [prepareForLLM(sampleListing({ id: "abc123" }))];
    create.mockResolvedValue(
      textResponse([
        {
          listing_id: prepared[0].listing_id,
          score: "YES",
          quality: "pass",
          value: "pass",
          aesthetic: "pass",
          size: "HIGH",
          reason: "Great match",
        },
      ]),
    );

    const provider = new ClaudeProvider(minimalConfig.llm);
    const results = await provider.scoreBatch(prepared, "system prompt");

    expect(results[0].score).toBe("YES");
    expect(results[0].reason).toBe("Great match");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: minimalConfig.llm.claude_model, system: "system prompt" }),
    );
  });

  it("scoreBatch falls back to MAYBE for every listing on malformed JSON", async () => {
    const prepared = [prepareForLLM(sampleListing({ id: "abc123" }))];
    create.mockResolvedValue({ content: [{ type: "text", text: "not json" }] });

    const provider = new ClaudeProvider(minimalConfig.llm);
    const results = await provider.scoreBatch(prepared, "system");

    expect(results[0].score).toBe("MAYBE");
    expect(results[0].listing_id).toBe(prepared[0].listing_id);
  });

  it("scoreBatch falls back to MAYBE when the API call throws", async () => {
    const prepared = [prepareForLLM(sampleListing({ id: "abc123" }))];
    create.mockRejectedValue(new Error("connection reset"));

    const provider = new ClaudeProvider(minimalConfig.llm);
    const results = await provider.scoreBatch(prepared, "system");

    expect(results[0].score).toBe("MAYBE");
    expect(results[0].reason).toBe("connection reset");
  });

  it("scoreWithImage returns MAYBE without calling the API when there's no image URL", async () => {
    const listing = prepareForLLM(sampleListing({ id: "abc123", imageUrl: null }));
    const provider = new ClaudeProvider(minimalConfig.llm);

    const result = await provider.scoreWithImage(listing, "system");
    expect(result.score).toBe("MAYBE");
    expect(result.reason).toBe("No image URL");
    expect(create).not.toHaveBeenCalled();
  });

  it("scoreWithImage parses a valid single-result response", async () => {
    const listing = prepareForLLM(sampleListing({ id: "abc123" }));
    create.mockResolvedValue(
      textResponse({
        listing_id: listing.listing_id,
        score: "YES",
        quality: "pass",
        value: "pass",
        aesthetic: "pass",
        size: "HIGH",
        reason: "Good in the photo",
      }),
    );

    const provider = new ClaudeProvider(minimalConfig.llm);
    const result = await provider.scoreWithImage(listing, "system");
    expect(result.score).toBe("YES");
  });

  it("scoreWithImage falls back to MAYBE when the API call throws", async () => {
    const listing = prepareForLLM(sampleListing({ id: "abc123" }));
    create.mockRejectedValue(new Error("vision unavailable"));

    const provider = new ClaudeProvider(minimalConfig.llm);
    const result = await provider.scoreWithImage(listing, "system");
    expect(result.score).toBe("MAYBE");
    expect(result.reason).toBe("vision unavailable");
  });
});
