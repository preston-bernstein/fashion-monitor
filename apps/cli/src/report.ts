#!/usr/bin/env node
import { loadCliConfig } from "./config.js";
import { openDatabase } from "@fm/core/storage/db.js";
import {
  fetchDailyRuns,
  fetchOverview,
  fetchPlatformAlerts,
  fetchRecentAlerts,
  fetchRunSummaries,
  fetchScoreByPlatform,
} from "@fm/core/analytics/queries.js";
import {
  formatFullReport,
  formatIntegrationFailures,
  formatIntegrationUptime,
  formatQueryScorecard,
} from "@fm/core/analytics/format-report.js";
import { ScrapeQueriesRepo } from "@fm/core/storage/repos/scrape-queries.js";
import { ConfigRevisionsRepo } from "@fm/core/storage/repos/config-revisions.js";
import { IntegrationHealthRepo } from "@fm/core/storage/repos/integration-health.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { parseReportArgs } from "./args.js";

const log = createLogger("cli.report");

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "report" });
  const { configPath, days } = parseReportArgs(process.argv.slice(2));
  const config = loadCliConfig(configPath);
  const db = openDatabase(config.database.path);

  try {
    const profileId = config.profile_id;
    const scrapeRepo = new ScrapeQueriesRepo(db, profileId);
    const revisionsRepo = new ConfigRevisionsRepo(db, profileId);
    const integrationRepo = new IntegrationHealthRepo(db, profileId);

    const report = formatFullReport({
      overview: fetchOverview(db, profileId),
      runs: fetchRunSummaries(db, 15),
      daily: fetchDailyRuns(db, days),
      scores: fetchScoreByPlatform(db, profileId),
      platformAlerts: fetchPlatformAlerts(db, profileId),
      alerts: fetchRecentAlerts(db, profileId, 10),
      queryScorecard: formatQueryScorecard(scrapeRepo.fetchScorecard()),
      integrationUptime: formatIntegrationUptime(integrationRepo.fetchUptime7d()),
      integrationFailures: formatIntegrationFailures(integrationRepo.fetchRecentFailures(15)),
      configRevisions: revisionsRepo.fetchRecent(5),
    });
    console.log(report);
    log.info(LogEvents.CliReportComplete, { profileId, days });
  } finally {
    db.close();
  }
}

main().catch((err) => {
  log.error(LogEvents.CliRunFailed, {
    error: err instanceof Error ? err.message : "unknown",
  });
  process.exit(1);
});
