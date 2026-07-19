import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Load `.env` into process.env (does not override existing vars). */
export function loadDotEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

export function hasEnv(...keys: string[]): boolean {
  return keys.every((k) => Boolean(process.env[k]?.trim()));
}

export type PlatformLiveRequirement = {
  platform: string;
  required: string[];
  optional: string[];
  note?: string;
};

export const PLATFORM_LIVE_REQUIREMENTS: PlatformLiveRequirement[] = [
  {
    platform: "ebay",
    required: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    optional: [],
    note: "eBay Developer Program OAuth app credentials",
  },
  {
    platform: "grailed",
    required: ["GRAILED_APP_ID", "GRAILED_API_KEY"],
    optional: [],
    note: "Algolia keys from Grailed web app (see spec)",
  },
  {
    platform: "depop",
    required: [],
    optional: ["SCRAPFLY_API_KEY"],
    note: "Live-verified 2026-07-19: plain impit HTTP call succeeds unassisted (no cookie/header engineering needed); ScrapFly is optional, for the rare case Cloudflare blocks the primary tier; DOM-extraction fallback also works without it",
  },
  {
    platform: "vestiaire",
    required: ["SCRAPFLY_API_KEY"],
    optional: [],
    note: "Cloudflare blocks direct fetch — ScrapFly required in practice",
  },
  {
    platform: "poshmark",
    required: [],
    optional: [],
    note: "Playwright + stealth; persistent profile at scraper.poshmark_profile_path",
  },
];

export function platformReady(req: PlatformLiveRequirement): boolean {
  return req.required.every((k) => hasEnv(k));
}

export function missingForPlatform(req: PlatformLiveRequirement): string[] {
  return req.required.filter((k) => !hasEnv(k));
}
