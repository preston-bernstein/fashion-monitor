import { describe, expect, it, afterEach } from "vitest";
import { getGrailedCredentials } from "../../src/platforms/grailed/env.js";
import { minimalConfig } from "../helpers/fixtures.js";
import type { Config } from "../../src/core/config.js";

describe("grailed credential resolution", () => {
  afterEach(() => {
    delete process.env.GRAILED_APP_ID;
    delete process.env.GRAILED_API_KEY;
  });

  it("throws when no credentials are available from config or env", () => {
    delete process.env.GRAILED_APP_ID;
    delete process.env.GRAILED_API_KEY;
    expect(() => getGrailedCredentials()).toThrow("GRAILED_APP_ID and GRAILED_API_KEY required");
  });

  it("falls back to env when config has no platform_credentials", () => {
    process.env.GRAILED_APP_ID = "env-app-id";
    process.env.GRAILED_API_KEY = "env-api-key";
    expect(getGrailedCredentials()).toEqual({ appId: "env-app-id", apiKey: "env-api-key" });
  });

  it("prefers the config-resolved credential over env (per-profile correctness)", () => {
    process.env.GRAILED_APP_ID = "shared-env-app-id";
    process.env.GRAILED_API_KEY = "shared-env-api-key";

    const config: Config = {
      ...minimalConfig,
      platform_credentials: {
        grailed_app_id: "profiles-own-app-id",
        grailed_api_key: "profiles-own-api-key",
      },
    };

    expect(getGrailedCredentials(config)).toEqual({
      appId: "profiles-own-app-id",
      apiKey: "profiles-own-api-key",
    });
  });
});
