import { describe, expect, it } from "vitest";
import { parseConfig, substituteEnvVars } from "../../src/core/config.js";

describe("config", () => {
  it("rejects invalid provider", () => {
    expect(() =>
      parseConfig({
        profile_id: "default",
        measurements: {},
        aesthetic_prompt: "test",
        price_ceiling: { default: 300 },
        platforms: { ebay: true },
        alert: {
          telegram_bot_token: "x",
          telegram_chat_id: "y",
        },
        llm: { provider: "invalid" },
      }),
    ).toThrow();
  });

  it("substitutes env vars", () => {
    process.env.TEST_TOKEN = "secret123";
    expect(substituteEnvVars("${TEST_TOKEN}")).toBe("secret123");
    delete process.env.TEST_TOKEN;
  });

  it("accepts minimal valid config", () => {
    const config = parseConfig({
      profile_id: "default",
      measurements: { typical_size: "XXL" },
      aesthetic_prompt: "Dark academic",
      price_ceiling: { default: 300 },
      platforms: {
        ebay: true,
        grailed: false,
        vestiaire: false,
        vinted: false,
        depop: false,
        poshmark: false,
      },
      alert: { telegram_bot_token: "tok", telegram_chat_id: "1" },
      llm: { provider: "mock" },
    });
    expect(config.llm.provider).toBe("mock");
    expect(config.llm.batch_size).toBe(15);
  });
});
