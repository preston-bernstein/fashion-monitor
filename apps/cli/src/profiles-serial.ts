import type { Config } from "@fm/core/core/config.js";
import { loadProfileConfig } from "@fm/core/core/profile-config.js";
import type { Db } from "@fm/core/storage/db.js";
import { ProfilesRepo } from "@fm/core/storage/repos/users.js";
import { ScrapeQueriesRepo } from "@fm/core/storage/repos/scrape-queries.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";

const log = createLogger("cli.profiles-serial");

export interface ProfilesTickResult {
  profileCount: number;
  failures: number;
}

/**
 * ADR-0005: one scheduled tick lists profiles and runs `runPhase` for each,
 * serially — parallel profiles would contend for the single shared GPU. A
 * per-profile failure is logged but does not abort the remaining profiles.
 *
 * Shared by run.ts (combined pipeline), scrape.ts, and score.ts so the
 * profile-loop/skip/error-isolation logic exists in exactly one place.
 */
export async function forEachProfileSerially<TStats>(
  db: Db,
  fileConfig: Config,
  runPhase: (config: Config) => Promise<TStats>,
): Promise<ProfilesTickResult> {
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
      const stats = await runPhase(config);
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
