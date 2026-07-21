import type { Config } from "@fm/core/core/config.js";
import type { Logger } from "@fm/core/lib/logging.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { closePoshmarkContext } from "@fm/core/platforms/poshmark/scraper.js";
import { openDatabase, type Db } from "@fm/core/storage/db.js";
import { seedProfileFromConfig } from "@fm/core/storage/seed.js";
import { loadCliConfig } from "./config.js";

/**
 * Shared scrape/run entrypoint bootstrap: load config, open the DB, seed the
 * profile, run `fn`, then always close the Poshmark sidecar context and the
 * DB — even on failure. `score.ts` doesn't use this (it never touches
 * Poshmark's browser session), so it keeps its own copy of the load/open/seed
 * setup rather than sharing this helper.
 */
export async function withCliDb<T>(
  configPath: string,
  fn: (db: Db, fileConfig: Config) => Promise<T>,
): Promise<T> {
  const fileConfig = loadCliConfig(configPath);
  const db = openDatabase(fileConfig.database.path);

  const now = new Date().toISOString();
  seedProfileFromConfig(db, fileConfig, now);

  try {
    return await fn(db, fileConfig);
  } finally {
    await closePoshmarkContext().catch(() => undefined);
    db.close();
  }
}

/** Shared `main().catch(...)` failure path for CLI entrypoints. */
export function reportCliFailure(log: Logger, err: unknown): void {
  log.error(LogEvents.CliRunFailed, {
    error: err instanceof Error ? err.message : "unknown",
  });
  process.exit(1);
}
