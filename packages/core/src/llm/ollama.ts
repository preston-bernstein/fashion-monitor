import { Ollama } from "ollama";
import type { LlmConfig } from "../core/config.js";
import type { PreparedListing, ScoringResult } from "../core/types.js";
import { ProviderError } from "../core/errors.js";
import { buildUserPrompt } from "./prompt-builder.js";
import { BatchSchema, ScoringResultSchema } from "./schemas.js";
import { type LLMProvider, maybeResult, reconcileBatchResults } from "./provider.js";

export class OllamaProvider implements LLMProvider {
  private readonly client: Ollama;
  private readonly textModel: string;
  private readonly visionModel: string | undefined;

  constructor(config: LlmConfig) {
    if (!config.ollama_host) {
      throw new ProviderError("ollama_host required for ollama provider", "ollama");
    }
    this.client = new Ollama({ host: config.ollama_host });
    this.textModel = config.ollama_text_model;
    this.visionModel = config.ollama_vision_model;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch {
      return false;
    }
  }

  async scoreBatch(listings: PreparedListing[], systemPrompt: string): Promise<ScoringResult[]> {
    if (listings.length === 0) return [];

    try {
      const response = await this.client.chat({
        model: this.textModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(listings) },
        ],
        format: "json",
        stream: false,
      });

      const content = response.message.content;
      const parsed = BatchSchema.parse(JSON.parse(content));
      return reconcileBatchResults(listings, parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown Ollama error";
      return listings.map((l) => maybeResult(l.listing_id, `Parse error: ${message}`));
    }
  }

  async scoreWithImage(listing: PreparedListing, systemPrompt: string): Promise<ScoringResult> {
    if (!this.visionModel) {
      return maybeResult(listing.listing_id, "No vision model configured");
    }
    if (!listing.image_url) {
      return maybeResult(listing.listing_id, "No image URL available");
    }

    try {
      const response = await this.client.chat({
        model: this.visionModel,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Score this listing with image. Listing: ${JSON.stringify(listing)}`,
            images: [listing.image_url],
          },
        ],
        format: "json",
        stream: false,
      });

      const parsed = ScoringResultSchema.parse(JSON.parse(response.message.content));
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Vision error";
      return maybeResult(listing.listing_id, message);
    }
  }
}

export function createOllamaProvider(config: LlmConfig): LLMProvider {
  return new OllamaProvider(config);
}
