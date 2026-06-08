import type { Browser, BrowserContext } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

let stealthEnabled = false;
let ephemeralBrowser: Browser | null = null;
const persistentContexts = new Map<string, BrowserContext>();

export function getStealthChromium() {
  if (!stealthEnabled) {
    chromium.use(StealthPlugin());
    stealthEnabled = true;
  }
  return chromium;
}

const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];

import { DEFAULT_USER_AGENT } from "../../lib/user-agent.js";

export async function launchStealthPersistentContext(profilePath: string): Promise<BrowserContext> {
  const existing = persistentContexts.get(profilePath);
  if (existing) return existing;

  const browser = getStealthChromium();
  const context = await browser.launchPersistentContext(profilePath, {
    headless: true,
    args: LAUNCH_ARGS,
    userAgent: DEFAULT_USER_AGENT,
  });
  persistentContexts.set(profilePath, context);
  return context;
}

export async function launchStealthEphemeralBrowser(): Promise<Browser> {
  if (ephemeralBrowser) return ephemeralBrowser;
  const browser = getStealthChromium();
  ephemeralBrowser = await browser.launch({
    headless: true,
    args: LAUNCH_ARGS,
  });
  return ephemeralBrowser;
}

export async function closeStealthPersistentContext(profilePath: string): Promise<void> {
  const context = persistentContexts.get(profilePath);
  if (context) {
    await context.close();
    persistentContexts.delete(profilePath);
  }
}

export async function closeStealthEphemeralBrowser(): Promise<void> {
  if (ephemeralBrowser) {
    await ephemeralBrowser.close();
    ephemeralBrowser = null;
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
  persistentContexts.clear();
}
