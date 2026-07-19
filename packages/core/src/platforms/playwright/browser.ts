import type { Browser, BrowserContext } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

export type StealthDriver = "patchright" | "legacy";

export function resolveStealthDriver(override?: StealthDriver): StealthDriver {
  if (override) return override;

  const requested = process.env.PLAYWRIGHT_STEALTH_DRIVER;
  if (requested === "patchright") return "patchright";
  if (!requested || requested === "legacy") return "legacy";

  console.warn(
    `  ! PLAYWRIGHT_STEALTH_DRIVER=${requested} is not a recognized driver, falling back to legacy stealth.`,
  );
  return "legacy";
}

let stealthEnabled = false;
let ephemeralBrowser: Browser | null = null;
let ephemeralBrowserDriver: StealthDriver | null = null;
const persistentContexts = new Map<string, BrowserContext>();

/**
 * Read-only visibility into whether an ephemeral browser is currently open and, if so,
 * which driver launched it. Lets a caller (verify-scrapers.ts's driver matrix) detect
 * whether a scraper it just ran actually invoked a Playwright/patchright browser at all
 * (e.g. Depop's impit-first HTTP path never touches this module when it succeeds) —
 * there is no other way to observe that from outside a scraper's own return value.
 */
export function getEphemeralBrowserDriver(): StealthDriver | null {
  return ephemeralBrowserDriver;
}

export function getStealthChromium() {
  if (!stealthEnabled) {
    chromium.use(StealthPlugin());
    stealthEnabled = true;
  }
  return chromium;
}

const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];

import { DEFAULT_USER_AGENT } from "../../lib/user-agent.js";

export async function launchStealthPersistentContext(
  profilePath: string,
  driverOverride?: StealthDriver,
): Promise<BrowserContext> {
  const driver = resolveStealthDriver(driverOverride);
  const cacheKey = `${driver}:${profilePath}`;

  const existing = persistentContexts.get(cacheKey);
  if (existing) return existing;

  if (driver === "patchright") {
    const { chromium: patchrightChromium } = await import("patchright");
    const launched = await patchrightChromium.launchPersistentContext(profilePath, {
      headless: true,
      args: LAUNCH_ARGS,
      userAgent: DEFAULT_USER_AGENT,
    });
    const candidate = launched as unknown as { newPage?: unknown; close?: unknown };
    if (typeof candidate.newPage !== "function" || typeof candidate.close !== "function") {
      throw new Error(
        "patchright chromium.launchPersistentContext() returned an object missing newPage/close — its BrowserContext shape no longer matches playwright's BrowserContext type. Refusing to cast.",
      );
    }
    const context = launched as unknown as BrowserContext;
    persistentContexts.set(cacheKey, context);
    return context;
  }

  const browser = getStealthChromium();
  const context = await browser.launchPersistentContext(profilePath, {
    headless: true,
    args: LAUNCH_ARGS,
    userAgent: DEFAULT_USER_AGENT,
  });
  persistentContexts.set(cacheKey, context);
  return context;
}

export async function launchStealthEphemeralBrowser(driverOverride?: StealthDriver): Promise<Browser> {
  const driver = resolveStealthDriver(driverOverride);

  if (ephemeralBrowser && ephemeralBrowserDriver === driver) {
    return ephemeralBrowser;
  }

  if (driver === "patchright") {
    const { chromium: patchrightChromium } = await import("patchright");
    const launched = await patchrightChromium.launch({
      headless: true,
      args: LAUNCH_ARGS,
    });
    const candidate = launched as unknown as { newPage?: unknown; close?: unknown };
    if (typeof candidate.newPage !== "function" || typeof candidate.close !== "function") {
      throw new Error(
        "patchright chromium.launch() returned an object missing newPage/close — its Browser shape no longer matches playwright's Browser type. Refusing to cast.",
      );
    }
    ephemeralBrowser = launched as unknown as Browser;
    ephemeralBrowserDriver = "patchright";
    return ephemeralBrowser;
  }

  const browser = getStealthChromium();
  ephemeralBrowser = await browser.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });
  ephemeralBrowserDriver = "legacy";
  return ephemeralBrowser;
}

export async function closeStealthPersistentContext(profilePath: string): Promise<void> {
  const suffix = `:${profilePath}`;
  for (const [key, context] of persistentContexts) {
    if (key.endsWith(suffix)) {
      await context.close();
      persistentContexts.delete(key);
    }
  }
}

export async function closeStealthEphemeralBrowser(): Promise<void> {
  if (ephemeralBrowser) {
    await ephemeralBrowser.close();
    ephemeralBrowser = null;
    ephemeralBrowserDriver = null;
  }
}

export async function closeAllStealthBrowsers(): Promise<void> {
  for (const [path, context] of persistentContexts) {
    await context.close();
    persistentContexts.delete(path);
  }
  await closeStealthEphemeralBrowser();
}

export function resetStealthStateForTests(): void {
  stealthEnabled = false;
  ephemeralBrowser = null;
  ephemeralBrowserDriver = null;
  persistentContexts.clear();
}
