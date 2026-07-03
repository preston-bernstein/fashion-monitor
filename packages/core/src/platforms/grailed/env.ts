import type { Config } from "../../core/config.js";

/**
 * Prefer the per-profile resolved credential (DB > env > config.yaml — see
 * profile-config.ts); fall back to the raw env var for callers that build a
 * Config without going through loadProfileConfig (e.g. verify-scrapers.ts).
 */
export function getGrailedCredentials(config?: Config): { appId: string; apiKey: string } {
  const appId = config?.platform_credentials?.grailed_app_id ?? process.env.GRAILED_APP_ID;
  const apiKey = config?.platform_credentials?.grailed_api_key ?? process.env.GRAILED_API_KEY;
  if (!appId || !apiKey) {
    throw new Error("GRAILED_APP_ID and GRAILED_API_KEY required");
  }
  return { appId, apiKey };
}

export async function validateGrailedCredentials(config?: Config): Promise<void> {
  getGrailedCredentials(config);
}
