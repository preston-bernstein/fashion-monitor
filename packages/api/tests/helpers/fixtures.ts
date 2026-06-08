import type { Config } from "@fm/core/core/config.js";

export const minimalConfig: Config = {
  profile_id: "default",
  measurements: { typical_size: "XXL", chest_in: "YOUR_CHEST" },
  aesthetic_prompt: "Dark academic aesthetic.",
  hard_no: ["slim fit"],
  positive_signals: { strong: ["corduroy"], weak: [] },
  price_ceiling: { tops: 300, pants: 250, outerwear: 500, default: 300 },
  platforms: {
    ebay: true,
    grailed: true,
    vestiaire: true,
    vinted: false,
    depop: true,
    poshmark: true,
  },
  llm: {
    provider: "mock",
    batch_size: 15,
    ollama_text_model: "qwen2.5:7b",
    claude_model: "claude-haiku-4-5",
    vision_backend: "ollama",
  },
  alert: {
    telegram_bot_token: "test-token",
    telegram_chat_id: "12345",
    mode: "immediate",
    notify_empty: false,
  },
  database: { path: ":memory:" },
  scraper: { poshmark_profile_path: "data/poshmark-profile" },
};
