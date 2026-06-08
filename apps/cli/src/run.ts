#!/usr/bin/env node
import { loadCliConfig } from "./config.js";
import { loadProfileConfig } from "@fm/core/core/profile-config.js";
import { openDatabase } from "@fm/core/storage/db.js";
import { seedProfileFromConfig } from "@fm/core/storage/seed.js";
import { runPipeline } from "@fm/core/pipeline/orchestrator.js";
import { closePoshmarkContext } from "@fm/core/platforms/poshmark/scraper.js";
import { closeAllStealthBrowsers } from "@fm/core/platforms/playwright/browser.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseRunArgs } from "./args.js";

const log = createLogger("cli.run");

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "run" });
  const { configPath, platforms } = parseRunArgs(process.argv.slice(2));
  const fileConfig = loadCliConfig(configPath);
  const db = openDatabase(fileConfig.database.path);

  const now = new Date().toISOString();
  seedProfileFromConfig(db, fileConfig, now);
  const config = loadProfileConfig(db, fileConfig.profile_id, {
    fallback: fileConfig,
    databasePath: fileConfig.database.path,
  });

  try {
    const stats = await runPipeline({ config, db, platformFilter: platforms });
    log.info(LogEvents.CliRunComplete, { profileId: config.profile_id, stats });
  } finally {
    await closePoshmarkContext().catch(() => undefined);
    await closeAllStealthBrowsers().catch(() => undefined);
    db.close();
  }
}

main().catch((err) => {
  log.error(LogEvents.CliRunFailed, {
    error: err instanceof Error ? err.message : "unknown",
  });
  process.exit(1);
});
