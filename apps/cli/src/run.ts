#!/usr/bin/env node
import { loadCliConfig } from "./config.js";
import { loadProfileConfig } from "@fm/core/core/profile-config.js";
import type { Config } from "@fm/core/core/config.js";
import type { Platform } from "@fm/core/core/types.js";
import { openDatabase } from "@fm/core/storage/db.js";
import type { Db } from "@fm/core/storage/db.js";
import { seedProfileFromConfig } from "@fm/core/storage/seed.js";
import { runPipeline } from "@fm/core/pipeline/orchestrator.js";
import type { PlatformScraper } from "@fm/core/platforms/types.js";
import type { LLMProvider } from "@fm/core/llm/provider.js";
import { ProfilesRepo } from "@fm/core/storage/repos/users.js";
import { ScrapeQueriesRepo } from "@fm/core/storage/repos/scrape-queries.js";
import { closePoshmarkContext } from "@fm/core/platforms/poshmark/scraper.js";
import { closeAllStealthBrowsers } from "@fm/core/platforms/playwright/browser.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseRunArgs } from "./args.js";

const log = createLogger("cli.run");

export interface RunTickResult {
  profileCount: number;
  failures: number;
}

/**
 * ADR-0005: one scheduled tick lists profiles and runs the existing
 * single-profile pipeline for each, serially — parallel profiles would
 * contend for the single shared GPU. A per-profile failure is logged but
 * does not abort the remaining profiles.
 */
export async function runProfilesSerially(
  db: Db,
  fileConfig: Config,
  platformFilter?: Platform[],
  // Test-only injection point, mirrors RunContext's own optional overrides;
  // production callers (main() below) never pass these.
  testOverrides?: { scrapers?: PlatformScraper[]; provider?: LLMProvider },
): Promise<RunTickResult> {
  const profiles = new ProfilesRepo(db).list();
  let failures = 0;
  for (const profile of profiles) {
    // Check the profile's OWN seeded monitors, not loadProfileConfig's
    // output: that function falls back to fileConfig.searches when a
    // profile has zero DB monitor rows, which would otherwise make an
    // unconfigured second profile silently scrape the first profile's
    // queries under its own profile_id.
    if (new ScrapeQueriesRepo(db, profile.id).listMonitors().length === 0) {
      log.info(LogEvents.PipelineProfileSkipped, {
        profileId: profile.id,
        reason: "no_monitors",
      });
      continue;
    }

    const config = loadProfileConfig(db, profile.id, {
      fallback: fileConfig,
      databasePath: fileConfig.database.path,
    });

    try {
      const stats = await runPipeline({
        config,
        db,
        platformFilter,
        scrapers: testOverrides?.scrapers,
        provider: testOverrides?.provider,
      });
      log.info(LogEvents.CliRunComplete, { profileId: profile.id, stats });
    } catch (err) {
      failures++;
      log.error(LogEvents.CliRunFailed, {
        profileId: profile.id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return { profileCount: profiles.length, failures };
}

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "run" });
  const { configPath, platforms } = parseRunArgs(process.argv.slice(2));
  const fileConfig = loadCliConfig(configPath);
  const db = openDatabase(fileConfig.database.path);

  const now = new Date().toISOString();
  seedProfileFromConfig(db, fileConfig, now);

  try {
    const { profileCount, failures } = await runProfilesSerially(db, fileConfig, platforms);
    // A tick where every profile errored is worth surfacing to the scheduler;
    // partial degradation (some profiles ok) stays a zero exit per-profile
    // fault isolation.
    if (profileCount > 0 && failures === profileCount) {
      process.exitCode = 1;
    }
  } finally {
    await closePoshmarkContext().catch(() => undefined);
    await closeAllStealthBrowsers().catch(() => undefined);
    db.close();
  }
}

// Guard so importing runProfilesSerially for tests doesn't also invoke the
// CLI entrypoint (which reads real config off disk and calls process.exit).
if (import.meta.main) {
  main().catch((err) => {
    log.error(LogEvents.CliRunFailed, {
      error: err instanceof Error ? err.message : "unknown",
    });
    process.exit(1);
  });
}
