#!/usr/bin/env node
import type { Config } from "@fm/core/core/config.js";
import type { Platform } from "@fm/core/core/types.js";
import type { Db } from "@fm/core/storage/db.js";
import { runPipeline } from "@fm/core/pipeline/orchestrator.js";
import type { PlatformScraper } from "@fm/core/platforms/types.js";
import type { LLMProvider } from "@fm/core/llm/provider.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseRunArgs } from "./args.js";
import { reportCliFailure, withCliDb } from "./cli-bootstrap.js";
import { forEachProfileSerially, type ProfilesTickResult } from "./profiles-serial.js";

const log = createLogger("cli.run");

export type RunTickResult = ProfilesTickResult;

/**
 * ADR-0005: one scheduled tick lists profiles and runs the existing
 * combined scrape+score pipeline for each, serially. See
 * `forEachProfileSerially` (profiles-serial.ts) for the shared
 * loop/skip/error-isolation logic — also used by scrape.ts/score.ts for the
 * split (VPN-tunneled scrape / untunneled score) deployment path.
 */
export async function runProfilesSerially(
  db: Db,
  fileConfig: Config,
  platformFilter?: Platform[],
  // Test-only injection point, mirrors RunContext's own optional overrides;
  // production callers (main() below) never pass these.
  testOverrides?: { scrapers?: PlatformScraper[]; provider?: LLMProvider },
): Promise<RunTickResult> {
  return forEachProfileSerially(db, fileConfig, (config) =>
    runPipeline({
      config,
      db,
      platformFilter,
      scrapers: testOverrides?.scrapers,
      provider: testOverrides?.provider,
    }),
  );
}

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "run" });
  const { configPath, platforms } = parseRunArgs(process.argv.slice(2));

  const { profileCount, failures } = await withCliDb(configPath, (db, fileConfig) =>
    runProfilesSerially(db, fileConfig, platforms),
  );
  // A tick where every profile errored is worth surfacing to the scheduler;
  // partial degradation (some profiles ok) stays a zero exit per-profile
  // fault isolation.
  if (profileCount > 0 && failures === profileCount) {
    process.exitCode = 1;
  }
}

// Guard so importing runProfilesSerially for tests doesn't also invoke the
// CLI entrypoint (which reads real config off disk and calls process.exit).
if (import.meta.main) {
  main().catch((err) => reportCliFailure(log, err));
}
