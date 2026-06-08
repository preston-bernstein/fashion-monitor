import type { LlmConfig } from "../core/config.js";
import type { PreparedListing, ScoringResult } from "../core/types.js";
import { createClaudeProvider } from "./claude.js";
import { createOllamaProvider } from "./ollama.js";
import type { LLMProvider } from "./provider.js";

export class HybridProvider implements LLMProvider {
  private readonly textProvider: LLMProvider;
  private readonly visionProvider: LLMProvider;

  constructor(config: LlmConfig) {
    this.textProvider = createOllamaProvider(config);
    this.visionProvider =
      config.vision_backend === "claude"
        ? createClaudeProvider(config)
        : createOllamaProvider(config);
  }

  async healthCheck(): Promise<boolean> {
    return this.textProvider.healthCheck();
  }

  async scoreBatch(listings: PreparedListing[], systemPrompt: string): Promise<ScoringResult[]> {
    return this.textProvider.scoreBatch(listings, systemPrompt);
  }

  async scoreWithImage(listing: PreparedListing, systemPrompt: string): Promise<ScoringResult> {
    return this.visionProvider.scoreWithImage(listing, systemPrompt);
  }
}

export function createHybridProvider(config: LlmConfig): LLMProvider {
  return new HybridProvider(config);
}
