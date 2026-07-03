import { describe, expect, it, vi, afterEach } from "vitest";
import { createEbayScraper } from "../../src/platforms/ebay/scraper.js";
import { minimalConfig } from "../helpers/fixtures.js";
import type { Config } from "../../src/core/config.js";

function decodeBasicAuth(header: string): { clientId: string; clientSecret: string } {
  const b64 = header.replace(/^Basic /, "");
  const [clientId, clientSecret] = Buffer.from(b64, "base64").toString("utf8").split(":");
  return { clientId, clientSecret };
}

describe("ebay credential resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
  });

  it("throws when neither config nor env has credentials", async () => {
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    const scraper = createEbayScraper(minimalConfig);
    const result = await scraper.search([{ queryId: "q1@ebay", text: "jacket", sourceQueryId: "q1" }]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET required");
  });

  it("uses the per-profile config credential for the OAuth request, not a shared env var", async () => {
    process.env.EBAY_CLIENT_ID = "shared-env-id";
    process.env.EBAY_CLIENT_SECRET = "shared-env-secret";

    const config: Config = {
      ...minimalConfig,
      platform_credentials: {
        ebay_client_id: "profiles-own-id",
        ebay_client_secret: "profiles-own-secret",
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok", expires_in: 3600 }),
      status: 200,
    });
    vi.stubGlobal("fetch", fetchMock);

    const scraper = createEbayScraper(config);
    await scraper.search([{ queryId: "q1@ebay", text: "jacket", sourceQueryId: "q1" }]);

    const [, tokenInit] = fetchMock.mock.calls[0];
    const auth = decodeBasicAuth((tokenInit.headers as Record<string, string>).Authorization);
    expect(auth).toEqual({ clientId: "profiles-own-id", clientSecret: "profiles-own-secret" });
  });
});
