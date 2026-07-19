#!/usr/bin/env node
import { loadCliConfig } from "./config.js";
import { openDatabase } from "@fm/core/storage/db.js";
import { seedProfileFromConfig } from "@fm/core/storage/seed.js";
import { runScorePhase } from "@fm/core/pipeline/orchestrator.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseScoreArgs } from "./args.js";
import { forEachProfileSerially } from "./profiles-serial.js";

const log = createLogger("cli.score");

/**
 * Score-only entrypoint: `runScorePhase` per profile — health-checks the
 * LLM provider, scores whatever `scrape.ts` left PENDING, dispatches
 * alerts. No scraper access, so this stays OUTSIDE the VPN-tunneled
 * `scraper-egress` network namespace and can reach the Ollama broker on the
 * LAN normally.
 */
async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "score" });
  const { configPath } = parseScoreArgs(process.argv.slice(2));
  const fileConfig = loadCliConfig(configPath);
  const db = openDatabase(fileConfig.database.path);

  const now = new Date().toISOString();
  seedProfileFromConfig(db, fileConfig, now);

  try {
    const { profileCount, failures } = await forEachProfileSerially(db, fileConfig, (config) =>
      runScorePhase({ config, db }),
    );
    if (profileCount > 0 && failures === profileCount) {
      process.exitCode = 1;
    }
  } finally {
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
