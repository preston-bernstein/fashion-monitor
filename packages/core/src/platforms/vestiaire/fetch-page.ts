import { fetchWithTimeout } from "../../lib/http.js";
import { DEFAULT_USER_AGENT } from "../../lib/user-agent.js";
import { LogEvents } from "../../lib/log-events.js";
import { createLogger } from "../../lib/logging.js";

const log = createLogger("platform.vestiaire.fetch");

export const VESTIAIRE_HEADERS = {
  "User-Agent": DEFAULT_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export class VestiaireRedirectError extends Error {
  constructor() {
    super("Vestiaire redirect — item removed");
    this.name = "VestiaireRedirectError";
  }
}

/**
 * `apiKey` should come from the per-profile resolved credential
 * (config.platform_credentials.scrapfly_api_key — see profile-config.ts);
 * falls back to the raw env var for callers that build a Config without
 * going through loadProfileConfig (e.g. verify-scrapers.ts).
 */
export async function fetchViaScrapfly(url: string, apiKey?: string): Promise<string> {
  const key = apiKey ?? process.env.SCRAPFLY_API_KEY;
  if (!key) {
    throw new Error("SCRAPFLY_API_KEY required for Cloudflare bypass");
  }

  const { ScrapflyClient, ScrapeConfig } = await import("scrapfly-sdk");
  const client = new ScrapflyClient({ key });
  const result = await client.scrape(new ScrapeConfig({ url, asp: true, render_js: false }));
  return (result as unknown as { content: string }).content;
}

export async function fetchVestiaireHtml(
  url: string,
  deps: { scrapfly?: (url: string) => Promise<string>; scrapflyApiKey?: string } = {},
): Promise<string> {
  const response = await fetchWithTimeout(url, { headers: VESTIAIRE_HEADERS });

  if (response.status === 308) {
    throw new VestiaireRedirectError();
  }

  if (response.ok) {
    return response.text();
  }

  if (response.status === 403 || response.status === 429) {
    log.warn(LogEvents.PlatformVestiaireFetchBlocked, {
      status: response.status,
      fallback: "scrapfly",
    });
    const scrapfly = deps.scrapfly ?? ((u: string) => fetchViaScrapfly(u, deps.scrapflyApiKey));
    return scrapfly(url);
  }

  throw new Error(`Vestiaire HTTP ${response.status}`);
}
