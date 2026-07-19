#!/usr/bin/env node
import { loadCliConfig } from "./config.js";
import { openDatabase } from "@fm/core/storage/db.js";
import { seedProfileFromConfig } from "@fm/core/storage/seed.js";
import { runScrapePhase } from "@fm/core/pipeline/orchestrator.js";
import { closePoshmarkContext } from "@fm/core/platforms/poshmark/scraper.js";
import { closeAllStealthBrowsers } from "@fm/core/platforms/playwright/browser.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseScrapeArgs } from "./args.js";
import { forEachProfileSerially } from "./profiles-serial.js";

const log = createLogger("cli.scrape");

/**
 * Scrape-only entrypoint: `runScrapePhase` per profile, no LLM access. This
 * is the half of the pipeline meant to run inside the VPN-tunneled
 * `scraper-egress` network namespace (`network_mode: container:gluetun-scraper`)
 * — see `score.ts` for the untunneled counterpart that reads what this
 * leaves PENDING and actually scores it.
 */
async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "scrape" });
  const { configPath, platforms } = parseScrapeArgs(process.argv.slice(2));
  const fileConfig = loadCliConfig(configPath);
  const db = openDatabase(fileConfig.database.path);

  const now = new Date().toISOString();
  seedProfileFromConfig(db, fileConfig, now);

  try {
    const { profileCount, failures } = await forEachProfileSerially(db, fileConfig, (config) =>
      runScrapePhase({ config, db, platformFilter: platforms }),
    );
    if (profileCount > 0 && failures === profileCount) {
      process.exitCode = 1;
    }
  } finally {
    await closePoshmarkContext().catch(() => undefined);
    await closeAllStealthBrowsers().catch(() => undefined);
    db.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    log.error(LogEvents.CliRunFailed, {
      error: err instanceof Error ? err.message : "unknown",
    });
    process.exit(1);
  });
}
