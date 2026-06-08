import { beforeAll, describe, expect, it } from "vitest";
import {
  hasEnv,
  loadDotEnv,
  missingForPlatform,
  PLATFORM_LIVE_REQUIREMENTS,
  platformReady,
} from "../helpers/live-env.js";
import { minimalConfig } from "../helpers/fixtures.js";
import { poshmarkLiveConfig } from "../helpers/db.js";

beforeAll(() => {
  loadDotEnv();
});

const ebayReq = PLATFORM_LIVE_REQUIREMENTS.find((r) => r.platform === "ebay")!;
const grailedReq = PLATFORM_LIVE_REQUIREMENTS.find((r) => r.platform === "grailed")!;

function assertListings(
  platform: string,
  result: { ok: boolean; listings?: unknown[]; error?: string },
) {
  expect(result.ok, `${platform} scrape failed: ${result.error ?? "unknown"}`).toBe(true);
  if (result.ok) {
    expect(result.listings!.length, `${platform} returned zero listings`).toBeGreaterThan(0);
    const first = result.listings![0] as {
      platform: string;
      title: string;
      url: string;
      price: number;
    };
    expect(first.platform).toBe(platform);
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.url).toMatch(/^https?:\/\//);
    expect(first.price).toBeGreaterThan(0);
  }
}

describe("@live platform smoke", () => {
  it.skipIf(!platformReady(ebayReq))(
    "@live eBay OAuth + search",
    async () => {
      const { createEbayScraper } = await import("../../src/platforms/ebay/scraper.js");
      const result = await createEbayScraper(minimalConfig).search(["men jacket XXL"]);
      assertListings("ebay", result);
    },
    60_000,
  );

  it.skipIf(!platformReady(grailedReq))(
    "@live Grailed Algolia search",
    async () => {
      const { createGrailedScraper } = await import("../../src/platforms/grailed/scraper.js");
      const result = await createGrailedScraper(minimalConfig).search(["corduroy jacket"]);
      assertListings("grailed", result);
    },
    60_000,
  );

  it("@live Depop search (impit or Playwright)", async () => {
    const { createDepopScraper } = await import("../../src/platforms/depop/scraper.js");
    const result = await createDepopScraper(minimalConfig).search(["corduroy jacket"]);
    assertListings("depop", result);
  }, 120_000);

  it("@live Vestiaire search (direct or ScrapFly)", async () => {
    const { createVestiaireScraper } = await import("../../src/platforms/vestiaire/scraper.js");
    const result = await createVestiaireScraper(minimalConfig).search(["corduroy jacket men"]);
    assertListings("vestiaire", result);
  }, 120_000);

  it("@live Poshmark search (Playwright stealth)", async () => {
    const { createPoshmarkScraper, closePoshmarkContext } =
      await import("../../src/platforms/poshmark/scraper.js");

    try {
      const result = await createPoshmarkScraper(poshmarkLiveConfig()).search([
        "corduroy jacket dark",
      ]);
      assertListings("poshmark", result);
    } finally {
      await closePoshmarkContext().catch(() => undefined);
    }
  }, 180_000);
});

describe("@live credential readiness", () => {
  it("reports which platforms can run with current env", () => {
    const report = PLATFORM_LIVE_REQUIREMENTS.map((req) => ({
      platform: req.platform,
      ready: req.required.length === 0 ? true : platformReady(req),
      missing: missingForPlatform(req),
      optional: req.optional.filter((k) => !hasEnv(k)),
    }));

    console.log("\n@live platform readiness:\n" + JSON.stringify(report, null, 2));

    // Always passes — informational; real assertions are in scrape tests above.
    expect(report).toHaveLength(5);
  });
});
