#!/usr/bin/env node
/**
 * Live scraper verification for all five platforms.
 * Loads .env, prints readiness, runs each scrape, exits non-zero on any hard failure.
 *
 * Also captures anti-bot posture (status code + screenshot) per platform per driver,
 * per docs/playwright-stealth-pilot.md step 4. Posture capture is diagnostic only —
 * it does not affect the script's exit code, only actual scrape failures do.
 *
 * Usage: npm run verify:scrapers
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  loadDotEnv,
  missingForPlatform,
  PLATFORM_LIVE_REQUIREMENTS,
  platformReady,
} from "../packages/core/tests/helpers/live-env.js";
import { minimalConfig } from "../packages/api/tests/helpers/fixtures.js";
import { resolvePlatformSearches } from "../packages/core/dist/config/searches.js";
import type { Platform } from "../packages/core/dist/core/types.js";
import { createEbayScraper } from "../packages/core/dist/platforms/ebay/scraper.js";
import { createGrailedScraper } from "../packages/core/dist/platforms/grailed/scraper.js";
import { createDepopScraper } from "../packages/core/dist/platforms/depop/scraper.js";
import { createVestiaireScraper } from "../packages/core/dist/platforms/vestiaire/scraper.js";
import {
  createPoshmarkScraper,
  closePoshmarkContext,
} from "../packages/core/dist/platforms/poshmark/scraper.js";
import {
  launchStealthEphemeralBrowser,
  closeStealthEphemeralBrowser,
} from "../packages/core/dist/platforms/playwright/browser.js";
import type { Config } from "../packages/core/dist/core/config.js";
import type { PlatformScraper } from "../packages/core/dist/platforms/types.js";

loadDotEnv();

// Anchor to this file's own location, not process.cwd() — the actual verify:scrapers
// invocation runs with cwd=packages/core, and artifact placement must be reproducible
// regardless of where the script is invoked from.
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARTIFACT_DIR = join(REPO_ROOT, "test-results", "verify-scrapers");

interface ScrapeReport {
  platform: string;
  status: "ok" | "skipped" | "failed";
  count?: number;
  sample?: string;
  error?: string;
  missing?: string[];
}

interface PostureCapture {
  platform: string;
  driver: string;
  statusCode: number | null;
  screenshotPath: string | null;
  error?: string;
}

/**
 * PLAYWRIGHT_STEALTH_DRIVER=rebrowser is documented (docs/playwright-stealth-pilot.md)
 * but not wired to any actual driver swap yet — browser.ts always launches the legacy
 * playwright-extra + stealth-plugin stack. Warn rather than silently mislabel captures.
 */
function resolveDriver(): string {
  const requested = process.env.PLAYWRIGHT_STEALTH_DRIVER;
  if (requested && requested !== "legacy") {
    console.warn(
      `  ! PLAYWRIGHT_STEALTH_DRIVER=${requested} requested but not wired yet (see docs/playwright-stealth-pilot.md) — capturing under driver="legacy"`,
    );
  }
  return "legacy";
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

/**
 * Status code implied by a scrape report: fetch-based platforms only reach "ok" when
 * response.ok, so success implies 2xx; failures carry the upstream status in the error
 * text for eBay/Grailed/Depop/Vestiaire's known error formats ("... failed: 403",
 * "... HTTP 403"). Best-effort — returns null when no status is derivable.
 */
function impliedStatusCode(report: ScrapeReport): number | null {
  if (report.status === "ok") return 200;
  if (report.status === "skipped") return null;
  const match = report.error?.match(/(?:HTTP|failed:)\s*(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * Independent posture probe: navigates to a representative search URL with its own
 * ephemeral browser (not the scraper's own context) and captures the main document's
 * response status + a screenshot. This is what actually answers "what does this
 * platform's edge show our current driver" — separate from whether the production
 * scraper's own retry/fallback logic ultimately succeeded.
 */
async function capturePosture(
  platform: string,
  url: string,
  driver: string,
): Promise<PostureCapture> {
  const browser = await launchStealthEphemeralBrowser();
  const page = await browser.newPage();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = join(ARTIFACT_DIR, `${platform}-${driver}-${timestamp}.png`);

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.screenshot({ path: screenshotPath });
    return { platform, driver, statusCode: response?.status() ?? null, screenshotPath };
  } catch (err) {
    return {
      platform,
      driver,
      statusCode: null,
      screenshotPath: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await page.close();
  }
}

function buildPostureUrl(platform: Platform, config: Config): string | null {
  const [query] = resolvePlatformSearches(config, platform);
  if (!query) return null;

  if (platform === "depop") {
    const params = new URLSearchParams({ q: query.text, gender: "male", sort: "newest" });
    return `https://www.depop.com/search/?${params}`;
  }
  if (platform === "vestiaire") {
    const params = new URLSearchParams({ q: query.text, universe: "M" });
    return `https://www.vestiairecollective.com/search/?${params}`;
  }
  if (platform === "poshmark") {
    const params = new URLSearchParams({ query: query.text, department: "Men" });
    return `https://poshmark.com/search?${params}`;
  }
  return null;
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

  const driver = resolveDriver();
  mkdirSync(ARTIFACT_DIR, { recursive: true });

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

  const postureByPlatform = new Map<string, PostureCapture>();
  for (const platform of ["depop", "vestiaire", "poshmark"] as const) {
    const url = buildPostureUrl(platform, config);
    if (!url) continue;
    try {
      postureByPlatform.set(platform, await capturePosture(platform, url, driver));
    } catch (err) {
      postureByPlatform.set(platform, {
        platform,
        driver,
        statusCode: null,
        screenshotPath: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await closeStealthEphemeralBrowser().catch(() => undefined);

  console.log("Results:\n");
  let failures = 0;
  let skipped = 0;

  for (const r of reports) {
    const statusCode = impliedStatusCode(r);
    const posture = postureByPlatform.get(r.platform);
    const postureBits = posture
      ? ` [driver=${posture.driver} status=${posture.statusCode ?? "?"}${posture.screenshotPath ? ` shot=${posture.screenshotPath}` : ""}${posture.error ? ` posture-error=${posture.error}` : ""}]`
      : statusCode !== null
        ? ` [status=${statusCode}]`
        : "";

    if (r.status === "ok") {
      console.log(`  ✓ ${r.platform.padEnd(10)} ${r.count} listings — ${r.sample}${postureBits}`);
    } else if (r.status === "skipped") {
      skipped++;
      console.log(`  ○ ${r.platform.padEnd(10)} skipped (need ${r.missing?.join(", ")})`);
    } else {
      failures++;
      console.log(`  ✗ ${r.platform.padEnd(10)} ${r.error}${postureBits}`);
    }
  }

  console.log(
    `\n${reports.filter((r) => r.status === "ok").length} ok, ${skipped} skipped, ${failures} failed`,
  );

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
