import type { LlmConfig } from "../core/config.js";
import type { LLMProvider } from "./provider.js";
import { createClaudeProvider } from "./claude.js";
import { createHybridProvider } from "./hybrid.js";
import { createMockProvider } from "./mock.js";
import { createOllamaProvider } from "./ollama.js";

export function createProviderFromConfig(config: LlmConfig): LLMProvider {
  switch (config.provider) {
    case "mock":
      return createMockProvider();
    case "ollama":
      return createOllamaProvider(config);
    case "claude":
      return createClaudeProvider(config);
    case "hybrid":
      return createHybridProvider(config);
    default:
      return createMockProvider();
  }
}
