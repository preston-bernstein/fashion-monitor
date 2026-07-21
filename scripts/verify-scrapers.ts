#!/usr/bin/env node
/**
 * Live scraper verification for all five platforms.
 * Loads .env, prints readiness, runs each scrape, exits non-zero on any hard failure.
 *
 * Also captures anti-bot posture (screenshot, best-effort status) per platform via the
 * stealth-sidecar — there is exactly one path now (the sidecar), not a legacy/patchright
 * driver choice, so posture capture is a single run per platform. Posture capture is
 * diagnostic only — it does not affect the script's exit code, only actual scrape
 * failures do.
 *
 * Usage: npm run verify:scrapers
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  checkHealth,
  createContext,
  createPage,
  navigate,
  getScreenshot,
  closePage,
  closeContext,
} from "../packages/core/dist/platforms/stealth-sidecar/client.js";
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
  // Populated inline for Depop/Poshmark, whose own scrape run also drives its posture
  // probe (see runDepopRow/runPoshmarkRow) — eBay/Grailed rely on impliedStatusCode
  // instead, and Vestiaire's posture lives in the separate postureByPlatform map.
  statusCode?: number | null;
  screenshotPath?: string | null;
}

interface PostureCapture {
  platform: string;
  statusCode: number | null;
  screenshotPath: string | null;
  error?: string;
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
 * Independent posture probe: opens its own sidecar context/page (not the scraper's own
 * context) and captures a screenshot of a representative search URL. This is what
 * actually answers "what does this platform's edge show us right now" — separate from
 * whether the production scraper's own retry/fallback logic ultimately succeeded.
 *
 * Any failure (sidecar unreachable, navigate failure, etc.) simply propagates — the
 * caller, `capturePostureSafe`, already catches and normalizes into an error-carrying
 * `PostureCapture`, so this function doesn't need its own duplicate catch.
 */
async function capturePosture(platform: string, url: string): Promise<PostureCapture> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const screenshotPath = join(ARTIFACT_DIR, `${platform}-${timestamp}.png`);

  await checkHealth();
  const { contextId } = await createContext();
  try {
    const { pageId } = await createPage(contextId);
    try {
      await navigate(pageId, url);
      const screenshot = await getScreenshot(pageId);
      writeFileSync(screenshotPath, screenshot);
      // The sidecar's navigate() contract doesn't return the navigated page's HTTP
      // response status the way Playwright's page.goto() response object did — there's
      // no equivalent field in the sidecar API today. statusCode is therefore always
      // null on this path; this is an intentional, minor loss of diagnostic
      // granularity, not a bug to work around.
      return { platform, statusCode: null, screenshotPath };
    } finally {
      await closePage(pageId).catch(() => undefined);
    }
  } finally {
    await closeContext(contextId).catch(() => undefined);
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

/**
 * Runs a posture capture and normalizes both "no URL for this platform" and "capture
 * threw" into the same `null`-or-`PostureCapture` shape, so callers don't each need
 * their own try/catch-shaped fallback literal.
 */
async function capturePostureSafe(platform: string, url: string | null): Promise<PostureCapture | null> {
  if (!url) return null;
  return capturePosture(platform, url).catch((err) => ({
    platform,
    statusCode: null,
    screenshotPath: null,
    error: err instanceof Error ? err.message : String(err),
  }));
}

/** Depop: single scrape-check row plus its own posture probe. */
async function runDepopRow(config: Config): Promise<ScrapeReport> {
  const depopReport = await runPlatform("depop", createDepopScraper(config), config);
  const depopUrl = buildPostureUrl("depop", config);
  const depopPosture = await capturePostureSafe("depop", depopUrl);
  return {
    ...depopReport,
    statusCode: depopPosture?.statusCode ?? null,
    screenshotPath: depopPosture?.screenshotPath ?? null,
  };
}

/**
 * Poshmark: single scrape-check row plus its own posture probe. Uses a fresh temp
 * profile dir (not a shared one) so repeated runs don't collide on Chromium's
 * SingletonLock or leftover session state.
 */
async function runPoshmarkRow(config: Config): Promise<ScrapeReport> {
  const poshmarkProfile = mkdtempSync(join(tmpdir(), "fm-verify-poshmark-"));
  const poshmarkConfig: Config = {
    ...config,
    scraper: { poshmark_profile_path: poshmarkProfile },
  };
  try {
    const poshmarkReport = await runPlatform(
      "poshmark",
      createPoshmarkScraper(poshmarkConfig),
      poshmarkConfig,
    );
    const poshmarkUrl = buildPostureUrl("poshmark", poshmarkConfig);
    const poshmarkPosture = await capturePostureSafe("poshmark", poshmarkUrl);
    return {
      ...poshmarkReport,
      statusCode: poshmarkPosture?.statusCode ?? null,
      screenshotPath: poshmarkPosture?.screenshotPath ?? null,
    };
  } finally {
    await closePoshmarkContext().catch(() => undefined);
    rmSync(poshmarkProfile, { recursive: true, force: true });
  }
}

function printReadiness(): void {
  for (const req of PLATFORM_LIVE_REQUIREMENTS) {
    const ready = req.required.length === 0 || platformReady(req);
    const miss = missingForPlatform(req);
    console.log(
      `  ${req.platform.padEnd(10)} ${ready ? "READY" : "SKIP (missing " + miss.join(", ") + ")"}${req.note ? " — " + req.note : ""}`,
    );
  }
}

/**
 * Vestiaire is the only platform left needing a posture probe run outside its own row:
 * Depop/Poshmark's scrape-check rows already carry their own posture inline (see
 * runDepopRow/runPoshmarkRow), so a separate pass for them here would just duplicate
 * rows.
 */
async function captureVestiairePosture(config: Config): Promise<Map<string, PostureCapture>> {
  const postureByPlatform = new Map<string, PostureCapture>();
  const url = buildPostureUrl("vestiaire", config);
  const posture = await capturePostureSafe("vestiaire", url);
  if (posture) postureByPlatform.set("vestiaire", posture);
  return postureByPlatform;
}

function formatShotBit(screenshotPath: string | null): string {
  return screenshotPath ? ` shot=${screenshotPath}` : "";
}

/**
 * Single formatter for the posture bits appended to a result line: prefers an
 * independent posture capture (Vestiaire) if present, falls back to a report's own
 * inline posture fields (Depop/Poshmark), and falls back further to the implied status
 * code alone (eBay/Grailed). There's only one path now — no driver to compare — so this
 * collapses what used to be three separate driver-aware formatters into one.
 */
function formatPostureBits(
  r: ScrapeReport,
  posture: PostureCapture | undefined,
  statusCode: number | null,
): string {
  const status = posture?.statusCode ?? r.statusCode ?? statusCode;
  const screenshotPath = posture?.screenshotPath ?? r.screenshotPath ?? null;
  const errorBit = posture?.error ? ` posture-error=${posture.error}` : "";

  if (status === null && !screenshotPath && !errorBit) return "";
  return ` [status=${status ?? "?"}${formatShotBit(screenshotPath)}${errorBit}]`;
}

/** Prints each report line and returns the failure/skipped counts for the exit-code decision. */
function printResults(
  reports: ScrapeReport[],
  postureByPlatform: Map<string, PostureCapture>,
): { failures: number; skipped: number } {
  console.log("Results:\n");
  let failures = 0;
  let skipped = 0;

  for (const r of reports) {
    const statusCode = impliedStatusCode(r);
    const postureBits = formatPostureBits(r, postureByPlatform.get(r.platform), statusCode);

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
  return { failures, skipped };
}

async function main(): Promise<void> {
  console.log("Fashion Monitor — live scraper verification\n");
  printReadiness();
  console.log("");

  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const config: Config = { ...minimalConfig };
  const reports: ScrapeReport[] = [];

  // All five platforms are a single scrape-check row each now — there is exactly one
  // path (the sidecar), not a legacy/patchright matrix.
  reports.push(await runPlatform("ebay", createEbayScraper(config), config));
  reports.push(await runPlatform("grailed", createGrailedScraper(config), config));
  reports.push(await runPlatform("vestiaire", createVestiaireScraper(config), config));
  reports.push(await runDepopRow(config));
  reports.push(await runPoshmarkRow(config));

  const postureByPlatform = await captureVestiairePosture(config);
  const { failures } = printResults(reports, postureByPlatform);

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
