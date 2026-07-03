import { describe, expect, it, vi, beforeEach } from "vitest";
import { prepareForLLM } from "../../src/core/types.js";
import { sampleListing, minimalConfig } from "../helpers/fixtures.js";
import { ProviderError } from "../../src/core/errors.js";

const list = vi.fn();
const chat = vi.fn();

vi.mock("ollama", () => ({
  Ollama: class MockOllama {
    list = list;
    chat = chat;
  },
}));

const { OllamaProvider } = await import("../../src/llm/ollama.js");

describe("OllamaProvider", () => {
  beforeEach(() => {
    list.mockReset();
    chat.mockReset();
  });

  it("throws without ollama_host", () => {
    expect(
      () => new OllamaProvider({ ...minimalConfig.llm, ollama_host: undefined }),
    ).toThrow(ProviderError);
  });

  it("healthCheck returns true when the client can list models, false on error", async () => {
    const provider = new OllamaProvider({ ...minimalConfig.llm, ollama_host: "http://broker" });

    list.mockResolvedValue({ models: [] });
    await expect(provider.healthCheck()).resolves.toBe(true);

    list.mockRejectedValue(new Error("broker unreachable"));
    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it("scoreBatch returns [] without calling the client for an empty list", async () => {
    const provider = new OllamaProvider({ ...minimalConfig.llm, ollama_host: "http://broker" });
    const results = await provider.scoreBatch([], "system");
    expect(results).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("scoreBatch parses a valid batch response and reconciles by listing id", async () => {
    const prepared = [prepareForLLM(sampleListing({ id: "abc123" }))];
    chat.mockResolvedValue({
      message: {
        content: JSON.stringify([
          {
            listing_id: prepared[0].listing_id,
            score: "YES",
            quality: "pass",
            value: "pass",
            aesthetic: "pass",
            size: "HIGH",
            reason: "Good match",
          },
        ]),
      },
    });

    const provider = new OllamaProvider({ ...minimalConfig.llm, ollama_host: "http://broker" });
    const results = await provider.scoreBatch(prepared, "system prompt");

    expect(results[0].score).toBe("YES");
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: minimalConfig.llm.ollama_text_model, format: "json" }),
    );
  });

  it("scoreBatch falls back to MAYBE for every listing when the client throws", async () => {
    const prepared = [prepareForLLM(sampleListing({ id: "abc123" }))];
    chat.mockRejectedValue(new Error("model not found"));

    const provider = new OllamaProvider({ ...minimalConfig.llm, ollama_host: "http://broker" });
    const results = await provider.scoreBatch(prepared, "system");

    expect(results[0].score).toBe("MAYBE");
    expect(results[0].reason).toContain("model not found");
  });

  it("scoreWithImage returns MAYBE without calling the client when no vision model is configured", async () => {
    const listing = prepareForLLM(sampleListing({ id: "abc123" }));
    const provider = new OllamaProvider({
      ...minimalConfig.llm,
      ollama_host: "http://broker",
      ollama_vision_model: undefined,
    });

    const result = await provider.scoreWithImage(listing, "system");
    expect(result.reason).toBe("No vision model configured");
    expect(chat).not.toHaveBeenCalled();
  });

  it("scoreWithImage returns MAYBE without calling the client when there's no image URL", async () => {
    const listing = prepareForLLM(sampleListing({ id: "abc123", imageUrl: null }));
    const provider = new OllamaProvider({
      ...minimalConfig.llm,
      ollama_host: "http://broker",
      ollama_vision_model: "llava",
    });

    const result = await provider.scoreWithImage(listing, "system");
    expect(result.reason).toBe("No image URL available");
    expect(chat).not.toHaveBeenCalled();
  });

  it("scoreWithImage sends the image and parses the response", async () => {
    const listing = prepareForLLM(sampleListing({ id: "abc123" }));
    chat.mockResolvedValue({
      message: {
        content: JSON.stringify({
          listing_id: listing.listing_id,
          score: "YES",
          quality: "pass",
          value: "pass",
          aesthetic: "pass",
          size: "HIGH",
          reason: "Looks good",
        }),
      },
    });

    const provider = new OllamaProvider({
      ...minimalConfig.llm,
      ollama_host: "http://broker",
      ollama_vision_model: "llava",
    });
    const result = await provider.scoreWithImage(listing, "system");

    expect(result.score).toBe("YES");
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ model: "llava" }));
  });

  it("scoreWithImage falls back to MAYBE when the client throws", async () => {
    const listing = prepareForLLM(sampleListing({ id: "abc123" }));
    chat.mockRejectedValue(new Error("vision model timeout"));

    const provider = new OllamaProvider({
      ...minimalConfig.llm,
      ollama_host: "http://broker",
      ollama_vision_model: "llava",
    });
    const result = await provider.scoreWithImage(listing, "system");

    expect(result.score).toBe("MAYBE");
    expect(result.reason).toBe("vision model timeout");
  });
});
