import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigFromFile } from "@fm/core/core/load-config.js";
import type { Config } from "@fm/core/core/config.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";

const log = createLogger("cli.config");

/** Resolve a CLI `--config` path and load it, or exit(1) with a clear message. */
export function loadCliConfig(configPath: string): Config {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) {
    log.error(LogEvents.CliConfigMissing, { path: resolved });
    process.exit(1);
  }
  const config = loadConfigFromFile(resolved);
  log.info(LogEvents.CliConfigLoaded, { path: resolved, profileId: config.profile_id });
  return config;
}
