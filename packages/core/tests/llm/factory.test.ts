import { describe, expect, it, vi } from "vitest";
import { minimalConfig } from "../helpers/fixtures.js";

const createMockProvider = vi.fn(() => ({ kind: "mock" }));
const createOllamaProvider = vi.fn(() => ({ kind: "ollama" }));
const createClaudeProvider = vi.fn(() => ({ kind: "claude" }));
const createHybridProvider = vi.fn(() => ({ kind: "hybrid" }));

vi.mock("../../src/llm/mock.js", () => ({ createMockProvider }));
vi.mock("../../src/llm/ollama.js", () => ({ createOllamaProvider }));
vi.mock("../../src/llm/claude.js", () => ({ createClaudeProvider }));
vi.mock("../../src/llm/hybrid.js", () => ({ createHybridProvider }));

const { createProviderFromConfig } = await import("../../src/llm/factory.js");

describe("createProviderFromConfig", () => {
  it("routes each configured provider name to its factory", () => {
    expect(createProviderFromConfig({ ...minimalConfig.llm, provider: "mock" })).toEqual({
      kind: "mock",
    });
    expect(createProviderFromConfig({ ...minimalConfig.llm, provider: "ollama" })).toEqual({
      kind: "ollama",
    });
    expect(createProviderFromConfig({ ...minimalConfig.llm, provider: "claude" })).toEqual({
      kind: "claude",
    });
    expect(createProviderFromConfig({ ...minimalConfig.llm, provider: "hybrid" })).toEqual({
      kind: "hybrid",
    });
  });

  it("falls back to the mock provider for an unrecognized provider name", () => {
    const config = { ...minimalConfig.llm, provider: "nonsense" } as unknown as typeof minimalConfig.llm;
    expect(createProviderFromConfig(config)).toEqual({ kind: "mock" });
  });
});
