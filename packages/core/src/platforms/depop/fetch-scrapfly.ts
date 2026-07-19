import { LogEvents } from "../../lib/log-events.js";
import { createLogger } from "../../lib/logging.js";

const log = createLogger("platform.depop.scrapfly");

export async function fetchDepopViaScrapfly(url: string, apiKey?: string): Promise<unknown> {
  const key = apiKey ?? process.env.SCRAPFLY_API_KEY;
  if (!key) {
    throw new Error("ScrapFly key required for Cloudflare bypass");
  }

  try {
    const { ScrapflyClient, ScrapeConfig } = await import("scrapfly-sdk");
    const client = new ScrapflyClient({ key });
    const result = await client.scrape(new ScrapeConfig({ url, asp: true, render_js: false }));
    const content = (result as unknown as { content: string }).content;
    const parsed = JSON.parse(content);
    log.info(LogEvents.PlatformDepopScrapflySuccess, { url });
    return parsed;
  } catch (error) {
    // Log only the error's type, never its raw .message — a ScrapFly SDK
    // error can embed the underlying HTTP request/response content, which
    // may echo the API key or a harvested Cloudflare cookie verbatim.
    const reason = error instanceof Error ? error.name : "UnknownError";
    log.warn(LogEvents.PlatformDepopScrapflyFailed, { url, reason });
    throw new Error(`Depop ScrapFly fetch failed: ${reason}`, { cause: error });
  }
}
