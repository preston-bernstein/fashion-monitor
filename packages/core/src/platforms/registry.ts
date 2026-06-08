import type { Config } from "../core/config.js";
import type { Platform } from "../core/types.js";
import { PLATFORMS } from "../core/types.js";
import type { PlatformScraper } from "./types.js";
import { createEbayScraper } from "./ebay/scraper.js";
import { createGrailedScraper } from "./grailed/scraper.js";
import { createVestiaireScraper } from "./vestiaire/scraper.js";
import { createDepopScraper } from "./depop/scraper.js";
import { createPoshmarkScraper } from "./poshmark/scraper.js";

type ScraperFactory = (config: Config) => PlatformScraper;

const FACTORIES: Record<Platform, ScraperFactory> = {
  ebay: createEbayScraper,
  grailed: createGrailedScraper,
  vestiaire: createVestiaireScraper,
  vinted: () => ({
    platform: "vinted" as const,
    async search() {
      return { ok: false, error: "Vinted disabled in v1", queryResults: [] };
    },
  }),
  depop: createDepopScraper,
  poshmark: createPoshmarkScraper,
};

export function getEnabledPlatforms(config: Config): Platform[] {
  return PLATFORMS.filter((p) => config.platforms[p]);
}

export function createScrapers(config: Config, platformFilter?: Platform[]): PlatformScraper[] {
  const enabled = getEnabledPlatforms(config);
  const targets = platformFilter ? enabled.filter((p) => platformFilter.includes(p)) : enabled;

  return targets.map((p) => FACTORIES[p](config));
}
