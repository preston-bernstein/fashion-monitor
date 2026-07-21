#!/usr/bin/env node
import { runScrapePhase } from "@fm/core/pipeline/orchestrator.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseScrapeArgs } from "./args.js";
import { reportCliFailure, withCliDb } from "./cli-bootstrap.js";
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

  const { profileCount, failures } = await withCliDb(configPath, (db, fileConfig) =>
    forEachProfileSerially(db, fileConfig, (config) =>
      runScrapePhase({ config, db, platformFilter: platforms }),
    ),
  );
  if (profileCount > 0 && failures === profileCount) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main().catch((err) => reportCliFailure(log, err));
}
