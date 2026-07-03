import { describe, expect, it, vi, beforeEach } from "vitest";
import { minimalConfig } from "../helpers/fixtures.js";

const ollamaProvider = {
  healthCheck: vi.fn(async () => true),
  scoreBatch: vi.fn(async () => [{ listing_id: "1", score: "YES" }]),
  scoreWithImage: vi.fn(async () => ({ listing_id: "1", score: "MAYBE" })),
};
const claudeProvider = {
  healthCheck: vi.fn(async () => true),
  scoreBatch: vi.fn(async () => [{ listing_id: "1", score: "NO" }]),
  scoreWithImage: vi.fn(async () => ({ listing_id: "1", score: "YES" })),
};

const createOllamaProvider = vi.fn(() => ollamaProvider);
const createClaudeProvider = vi.fn(() => claudeProvider);

vi.mock("../../src/llm/ollama.js", () => ({ createOllamaProvider }));
vi.mock("../../src/llm/claude.js", () => ({ createClaudeProvider }));

const { HybridProvider } = await import("../../src/llm/hybrid.js");

describe("HybridProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always uses Ollama for text scoring and healthCheck regardless of vision_backend", async () => {
    const hybrid = new HybridProvider({ ...minimalConfig.llm, vision_backend: "claude" });

    await hybrid.healthCheck();
    expect(ollamaProvider.healthCheck).toHaveBeenCalledOnce();
    expect(claudeProvider.healthCheck).not.toHaveBeenCalled();

    const results = await hybrid.scoreBatch([], "system");
    expect(ollamaProvider.scoreBatch).toHaveBeenCalledWith([], "system");
    expect(results).toEqual([{ listing_id: "1", score: "YES" }]);
  });

  it("routes vision scoring to Claude when vision_backend is claude", async () => {
    const hybrid = new HybridProvider({ ...minimalConfig.llm, vision_backend: "claude" });
    const listing = { listing_id: "1" } as never;

    const result = await hybrid.scoreWithImage(listing, "system");
    expect(claudeProvider.scoreWithImage).toHaveBeenCalledWith(listing, "system");
    expect(ollamaProvider.scoreWithImage).not.toHaveBeenCalled();
    expect(result.score).toBe("YES");
  });

  it("routes vision scoring to Ollama when vision_backend is ollama", async () => {
    const hybrid = new HybridProvider({ ...minimalConfig.llm, vision_backend: "ollama" });
    const listing = { listing_id: "1" } as never;

    const result = await hybrid.scoreWithImage(listing, "system");
    expect(ollamaProvider.scoreWithImage).toHaveBeenCalledWith(listing, "system");
    expect(claudeProvider.scoreWithImage).not.toHaveBeenCalled();
    expect(result.score).toBe("MAYBE");
  });

  it("never constructs a Claude provider when vision_backend is ollama", () => {
    createClaudeProvider.mockClear();
    new HybridProvider({ ...minimalConfig.llm, vision_backend: "ollama" });
    expect(createClaudeProvider).not.toHaveBeenCalled();
  });
});
