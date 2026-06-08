import Anthropic from "@anthropic-ai/sdk";
import type { LlmConfig } from "../core/config.js";
import type { PreparedListing, ScoringResult } from "../core/types.js";
import { ProviderError } from "../core/errors.js";
import { buildUserPrompt } from "./prompt-builder.js";
import { BatchSchema, ScoringResultSchema } from "./schemas.js";
import { type LLMProvider, maybeResult, reconcileBatchResults } from "./provider.js";

export class ClaudeProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: LlmConfig) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ProviderError("ANTHROPIC_API_KEY required for claude provider", "claude");
    }
    this.client = new Anthropic({ apiKey });
    this.model = config.claude_model;
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private async chat(
    systemPrompt: string,
    userContent: string | Anthropic.MessageParam["content"],
  ) {
    return this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
  }

  private extractText(content: Anthropic.ContentBlock[]): string {
    const block = content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new Error("No text in Claude response");
    }
    return block.text;
  }

  async scoreBatch(listings: PreparedListing[], systemPrompt: string): Promise<ScoringResult[]> {
    if (listings.length === 0) return [];

    try {
      const response = await this.chat(systemPrompt, buildUserPrompt(listings));
      const text = this.extractText(response.content);
      const parsed = BatchSchema.parse(JSON.parse(text));
      return reconcileBatchResults(listings, parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Claude error";
      return listings.map((l) => maybeResult(l.listing_id, message));
    }
  }

  async scoreWithImage(listing: PreparedListing, systemPrompt: string): Promise<ScoringResult> {
    if (!listing.image_url) {
      return maybeResult(listing.listing_id, "No image URL");
    }

    try {
      const response = await this.chat(systemPrompt, [
        {
          type: "image",
          source: { type: "url", url: listing.image_url },
        },
        {
          type: "text",
          text: `Score this listing. Return single JSON object. Listing: ${JSON.stringify(listing)}`,
        },
      ]);
      const text = this.extractText(response.content);
      return ScoringResultSchema.parse(JSON.parse(text));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Claude vision error";
      return maybeResult(listing.listing_id, message);
    }
  }
}

export function createClaudeProvider(config: LlmConfig): LLMProvider {
  return new ClaudeProvider(config);
}
