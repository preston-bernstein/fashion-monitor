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
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  resolveStealthDriver,
  getEphemeralBrowserDriver,
} from "../packages/core/dist/platforms/playwright/browser.js";
import type { StealthDriver } from "../packages/core/dist/platforms/playwright/browser.js";
import type { Config } from "../packages/core/dist/core/config.js";
import type { PlatformScraper } from "../packages/core/dist/platforms/types.js";

loadDotEnv();

// Anchor to this file's own location, not process.cwd() — the actual verify:scrapers
// invocation runs with cwd=packages/core, and artifact placement must be reproducible
// regardless of where the script is invoked from.
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARTIFACT_DIR = join(REPO_ROOT, "test-results", "verify-scrapers");

// Depop and Poshmark are run once per driver in this matrix (4 scrape-check rows total)
// so we can directly compare legacy stealth vs patchright behavior for the two platforms
// that actually launch a browser (or, for Depop, might fall back to one). eBay, Grailed,
// and Vestiaire are driver-agnostic for scraping purposes and keep running once each.
const DRIVER_MATRIX = ["legacy", "patchright"] as const satisfies readonly StealthDriver[];

interface ScrapeReport {
  platform: string;
  status: "ok" | "skipped" | "failed";
  count?: number;
  sample?: string;
  error?: string;
  missing?: string[];
  // "n/a" is a local sentinel: Depop's impit-first HTTP path can succeed without ever
  // launching a Playwright/patchright browser, so there's no real driver to attribute.
  driver?: StealthDriver | "n/a";
  // Populated inline for Depop/Poshmark's per-driver matrix rows (each row needs its own
  // independent posture probe, since there are 2 rows per platform now, not 1 — the
  // single-entry postureByPlatform map below only serves platforms with exactly one row).
  statusCode?: number | null;
  screenshotPath?: string | null;
}

interface PostureCapture {
  platform: string;
  driver: StealthDriver;
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
 * Independent posture probe: navigates to a representative search URL with its own
 * ephemeral browser (not the scraper's own context) and captures the main document's
 * response status + a screenshot. This is what actually answers "what does this
 * platform's edge show our current driver" — separate from whether the production
 * scraper's own retry/fallback logic ultimately succeeded.
 */
async function capturePosture(
  platform: string,
  url: string,
  driver: StealthDriver,
): Promise<PostureCapture> {
  const browser = await launchStealthEphemeralBrowser(driver);
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

/**
 * Runs a posture capture for a matrix row and normalizes both "no URL for this platform"
 * and "capture threw" into the same `null`-or-`PostureCapture` shape, so callers don't
 * each need their own try/catch-shaped fallback literal.
 */
async function capturePostureSafe(
  platform: string,
  url: string | null,
  driver: StealthDriver,
): Promise<PostureCapture | null> {
  if (!url) return null;
  return capturePosture(platform, url, driver).catch((err) => ({
    platform,
    driver,
    statusCode: null,
    screenshotPath: null,
    error: err instanceof Error ? err.message : String(err),
  }));
}

/**
 * Depop's scraper tries impit (plain HTTP) first and only falls back to a
 * Playwright/patchright browser on failure. If no ephemeral browser was ever opened, the
 * configured driver was never actually exercised — record "n/a" rather than attributing a
 * browser driver to an HTTP-only request.
 */
async function runDepopMatrixRow(config: Config, matrixDriver: StealthDriver): Promise<ScrapeReport> {
  const depopReport = await runPlatform("depop", createDepopScraper(config), config);
  const actualDepopDriver = getEphemeralBrowserDriver();
  const depopUrl = buildPostureUrl("depop", config);
  const depopPosture = await capturePostureSafe("depop", depopUrl, matrixDriver);
  await closeStealthEphemeralBrowser().catch(() => undefined);
  return {
    ...depopReport,
    driver: actualDepopDriver ?? "n/a",
    statusCode: depopPosture?.statusCode ?? null,
    screenshotPath: depopPosture?.screenshotPath ?? null,
  };
}

/**
 * Poshmark always uses a persistent Playwright/patchright context — no HTTP-only path —
 * so the configured driver is always the real driver used. A fresh temp profile dir per
 * driver iteration (not one shared dir for the whole run) avoids Chromium's SingletonLock
 * collision if both drivers' contexts were ever open close in time.
 */
async function runPoshmarkMatrixRow(matrixDriver: StealthDriver): Promise<ScrapeReport> {
  const poshmarkProfile = mkdtempSync(join(tmpdir(), "fm-verify-poshmark-"));
  const poshmarkConfig: Config = {
    ...minimalConfig,
    scraper: { poshmark_profile_path: poshmarkProfile },
  };
  try {
    const poshmarkReport = await runPlatform(
      "poshmark",
      createPoshmarkScraper(poshmarkConfig),
      poshmarkConfig,
    );
    const poshmarkUrl = buildPostureUrl("poshmark", poshmarkConfig);
    const poshmarkPosture = await capturePostureSafe("poshmark", poshmarkUrl, matrixDriver);
    return {
      ...poshmarkReport,
      driver: matrixDriver,
      statusCode: poshmarkPosture?.statusCode ?? null,
      screenshotPath: poshmarkPosture?.screenshotPath ?? null,
    };
  } finally {
    await closeStealthEphemeralBrowser().catch(() => undefined);
    await closePoshmarkContext().catch(() => undefined);
    rmSync(poshmarkProfile, { recursive: true, force: true });
  }
}

/**
 * Depop + Poshmark driver matrix: run each once per driver in DRIVER_MATRIX (4 rows
 * total), pushed into `reports`. The env var is restored in the outer finally only after
 * BOTH platforms and BOTH drivers have completed — not per-iteration — so the caller's
 * later single-driver code (posture probing) sees a clean, operator-configured value
 * rather than leftover matrix state.
 */
async function runDriverMatrix(config: Config, reports: ScrapeReport[]): Promise<void> {
  const originalDriverEnv = process.env.PLAYWRIGHT_STEALTH_DRIVER;
  try {
    for (const matrixDriver of DRIVER_MATRIX) {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = matrixDriver;
      reports.push(await runDepopMatrixRow(config, matrixDriver));
      reports.push(await runPoshmarkMatrixRow(matrixDriver));
    }
  } finally {
    if (originalDriverEnv === undefined) {
      delete process.env.PLAYWRIGHT_STEALTH_DRIVER;
    } else {
      process.env.PLAYWRIGHT_STEALTH_DRIVER = originalDriverEnv;
    }
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
 * Vestiaire is the only platform left needing a posture probe: Depop/Poshmark's
 * driver-matrix scrape-check rows already tell us what we need per-driver, so a separate
 * posture pass for them here would just duplicate rows. Driver is resolved fresh here
 * (after runDriverMatrix has restored the env var) so posture reflects whatever driver
 * the operator actually configured, not leftover matrix state.
 */
async function captureVestiairePosture(config: Config): Promise<Map<string, PostureCapture>> {
  const driver = resolveStealthDriver();
  const postureByPlatform = new Map<string, PostureCapture>();
  const url = buildPostureUrl("vestiaire", config);
  const posture = await capturePostureSafe("vestiaire", url, driver);
  if (posture) postureByPlatform.set("vestiaire", posture);
  await closeStealthEphemeralBrowser().catch(() => undefined);
  return postureByPlatform;
}

function formatShotBit(screenshotPath: string | null): string {
  return screenshotPath ? ` shot=${screenshotPath}` : "";
}

function formatFromPosture(posture: PostureCapture): string {
  const status = posture.statusCode ?? "?";
  const errorBit = posture.error ? ` posture-error=${posture.error}` : "";
  return ` [driver=${posture.driver} status=${status}${formatShotBit(posture.screenshotPath)}${errorBit}]`;
}

function formatFromReportDriver(r: ScrapeReport, statusCode: number | null): string {
  const status = r.statusCode ?? statusCode ?? "?";
  return ` [driver=${r.driver} status=${status}${formatShotBit(r.screenshotPath ?? null)}]`;
}

function formatPostureBits(
  r: ScrapeReport,
  posture: PostureCapture | undefined,
  statusCode: number | null,
): string {
  if (posture) return formatFromPosture(posture);
  if (r.driver) return formatFromReportDriver(r, statusCode);
  if (statusCode === null) return "";
  return ` [status=${statusCode}]`;
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

  // eBay, Grailed, Vestiaire are driver-agnostic scrape checks — run once each, unchanged.
  reports.push(await runPlatform("ebay", createEbayScraper(config), config));
  reports.push(await runPlatform("grailed", createGrailedScraper(config), config));
  reports.push(await runPlatform("vestiaire", createVestiaireScraper(config), config));

  await runDriverMatrix(config, reports);
  const postureByPlatform = await captureVestiairePosture(config);
  const { failures } = printResults(reports, postureByPlatform);

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
