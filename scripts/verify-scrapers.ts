#!/usr/bin/env node
/**
 * Live scraper verification for all five platforms.
 * Loads .env, prints readiness, runs each scrape, exits non-zero on any hard failure.
 *
 * Usage: npm run verify:scrapers
 */
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadDotEnv,
  missingForPlatform,
  PLATFORM_LIVE_REQUIREMENTS,
  platformReady,
} from "../packages/core/tests/helpers/live-env.js";
import { minimalConfig } from "../packages/api/tests/helpers/fixtures.js";
import { resolvePlatformSearches } from "@fm/core/config/searches.js";
import type { Platform } from "@fm/core/core/types.js";
import { createEbayScraper } from "@fm/core/platforms/ebay/scraper.js";
import { createGrailedScraper } from "@fm/core/platforms/grailed/scraper.js";
import { createDepopScraper } from "@fm/core/platforms/depop/scraper.js";
import { createVestiaireScraper } from "@fm/core/platforms/vestiaire/scraper.js";
import { createPoshmarkScraper, closePoshmarkContext } from "@fm/core/platforms/poshmark/scraper.js";
import type { Config } from "@fm/core/core/config.js";
import type { PlatformScraper } from "@fm/core/platforms/types.js";

loadDotEnv();

interface ScrapeReport {
  platform: string;
  status: "ok" | "skipped" | "failed";
  count?: number;
  sample?: string;
  error?: string;
  missing?: string[];
}

async function runPlatform(
  platform: Platform,
  scraper: PlatformScraper,
  config: Config,
): Promise<ScrapeReport> {
  const req = PLATFORM_LIVE_REQUIREMENTS.find((r) => r.platform === platform)!;
  if (req.required.length > 0 && !platformReady(req)) {
    return { platform, status: "skipped", missing: missingForPlatform(req) };
  }

  try {
    const queries = resolvePlatformSearches(config, platform);
    const result = await scraper.search(queries);
    if (!result.ok) {
      return { platform, status: "failed", error: result.error };
    }
    if (result.listings.length === 0) {
      return { platform, status: "failed", error: "Scrape returned zero listings" };
    }
    const first = result.listings[0];
    return {
      platform,
      status: "ok",
      count: result.listings.length,
      sample: first ? `${first.title} — $${first.price}` : undefined,
    };
  } catch (err) {
    return {
      platform,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  console.log("Fashion Monitor — live scraper verification\n");

  for (const req of PLATFORM_LIVE_REQUIREMENTS) {
    const ready = req.required.length === 0 || platformReady(req);
    const miss = missingForPlatform(req);
    console.log(
      `  ${req.platform.padEnd(10)} ${ready ? "READY" : "SKIP (missing " + miss.join(", ") + ")"}${req.note ? " — " + req.note : ""}`,
    );
  }
  console.log("");

  const poshmarkProfile = mkdtempSync(join(tmpdir(), "fm-verify-poshmark-"));
  const config: Config = { ...minimalConfig, scraper: { poshmark_profile_path: poshmarkProfile } };

  const reports: ScrapeReport[] = [];

  reports.push(await runPlatform("ebay", createEbayScraper(config), config));
  reports.push(await runPlatform("grailed", createGrailedScraper(config), config));
  reports.push(await runPlatform("depop", createDepopScraper(config), config));
  reports.push(await runPlatform("vestiaire", createVestiaireScraper(config), config));

  try {
    reports.push(await runPlatform("poshmark", createPoshmarkScraper(config), config));
  } finally {
    await closePoshmarkContext().catch(() => undefined);
  }

  console.log("Results:\n");
  let failures = 0;
  let skipped = 0;

  for (const r of reports) {
    if (r.status === "ok") {
      console.log(`  ✓ ${r.platform.padEnd(10)} ${r.count} listings — ${r.sample}`);
    } else if (r.status === "skipped") {
      skipped++;
      console.log(`  ○ ${r.platform.padEnd(10)} skipped (need ${r.missing?.join(", ")})`);
    } else {
      failures++;
      console.log(`  ✗ ${r.platform.padEnd(10)} ${r.error}`);
    }
  }

  console.log(`\n${reports.filter((r) => r.status === "ok").length} ok, ${skipped} skipped, ${failures} failed`);

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
