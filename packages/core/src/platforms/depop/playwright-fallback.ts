import type { Listing } from "../../core/types.js";
import { launchStealthEphemeralBrowser } from "../playwright/browser.js";
import { buildDepopSearchUrl, extractDepopListingsFromHtml } from "./parse-rsc.js";

export async function scrapeDepopViaPlaywright(query: string): Promise<Listing[]> {
  const browser = await launchStealthEphemeralBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(buildDepopSearchUrl(query), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const consent = page
      .locator('#onetrust-accept-btn-handler, button:has-text("Accept all")')
      .first();
    if (await consent.count()) {
      await consent.click({ timeout: 5_000 }).catch(() => undefined);
    }

    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(2_000);
      const listings = extractDepopListingsFromHtml(await page.content());
      if (listings.length > 0) return listings;
    }

    return [];
  } finally {
    await page.close();
  }
}
