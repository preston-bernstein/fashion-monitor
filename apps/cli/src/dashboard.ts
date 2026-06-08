#!/usr/bin/env node
import { loadCliConfig } from "./config.js";
import { openDatabase } from "@fm/core/storage/db.js";
import { seedProfileFromConfig } from "@fm/core/storage/seed.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { ensureAdmin } from "@fm/api/web/auth.js";
import { createDashboardServer } from "@fm/api/dashboard/server.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseDashboardArgs } from "./args.js";

const log = createLogger("cli.dashboard");

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "dashboard" });
  const { configPath, host, port } = parseDashboardArgs(process.argv.slice(2));
  const config = loadCliConfig(configPath);
  const db = openDatabase(config.database.path);
  const now = new Date().toISOString();

  seedProfileFromConfig(db, config, now);
  const audit = new AuditLogRepo(db, config.profile_id);

  try {
    await ensureAdmin(
      db,
      config.profile_id,
      { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
      now,
      audit,
    );
  } catch (err) {
    log.error(LogEvents.CliDashboardFailed, {
      error: (err as Error).message,
    });
    process.exit(1);
  }

  const dashboard = await createDashboardServer({
    config,
    db,
    host,
    port,
    sessionSecret: process.env.SESSION_SECRET,
    secretsKey: process.env.SECRETS_KEY,
    cookieSecure: process.env.COOKIE_SECURE === "true",
  });

  const shutdown = async () => {
    await dashboard.stop().catch(() => undefined);
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await dashboard.start();
  log.info(LogEvents.CliDashboardStarted, {
    url: `http://${host}:${port}/`,
    profileId: config.profile_id,
    database: config.database.path,
    secretsEnabled: Boolean(process.env.SECRETS_KEY),
  });
}

main().catch((err) => {
  log.error(LogEvents.CliDashboardFailed, {
    error: err instanceof Error ? err.message : "unknown",
  });
  process.exit(1);
});
