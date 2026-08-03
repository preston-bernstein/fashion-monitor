#!/usr/bin/env node
/**
 * Dead-scraper watchdog: alerts when no scrape run has finished successfully
 * within `--max-hours` (default 48h). Meant to be run on a periodic timer
 * independent of the scrape/score containers themselves — the whole point is
 * to notice when THOSE stop running (crash, missing schedule, wiring bug),
 * which by definition nothing inside the scrape/score pipeline can report on
 * its own. See docs/adr and grafana/ for the rest of this repo's monitoring;
 * this fills the one gap neither covered: "has the pipeline gone silent."
 *
 * Publishes straight to the configured ntfy topic (same `alert.ntfy_url`/
 * `alert.ntfy_topic`/`ntfy_token` used by the app's own alerts) rather than
 * going through `@fm/core/alerts/ntfy.ts`'s `NtfyAlerter` — that class's
 * `AlertClient` interface is scoped to listing alerts (sendAlert/sendDigest/
 * sendEmptyRunNotice/sendTestNotification) and is also mid-migration
 * (Telegram to ntfy, see fashion-monitor-change-control non-negotiable #9);
 * this stays out of that file entirely rather than extending a fenced,
 * in-flight interface for an unrelated concern. The publish shape below
 * intentionally mirrors NtfyAlerter's so the two stay consistent.
 *
 * Usage: node apps/cli/dist/check-scraper-health.js --config config.yaml [--max-hours 48]
 */
import { openDatabase } from "@fm/core/storage/db.js";
import { RunsRepo } from "@fm/core/storage/repos/runs.js";
import { evaluateScraperStaleness } from "@fm/core/analytics/staleness.js";
import { fetchWithTimeout } from "@fm/core/lib/http.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { loadCliConfig } from "./config.js";
import { parseScraperHealthArgs } from "./args.js";

const log = createLogger("cli.scraper-health");

async function publishStaleAlert(
  ntfyUrl: string,
  ntfyTopic: string,
  ntfyToken: string | undefined,
  summary: string,
): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;

  try {
    const response = await fetchWithTimeout(ntfyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        topic: ntfyTopic,
        title: "\u{1F6A8} Fashion Monitor scraper is dead",
        message: summary,
        priority: 5,
        tags: ["rotating_light"],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "check-scraper-health" });
  const { configPath, maxHours } = parseScraperHealthArgs(process.argv.slice(2));
  const config = loadCliConfig(configPath);
  const db = openDatabase(config.database.path);

  try {
    const runsRepo = new RunsRepo(db, config.profile_id);
    // 30 is generous headroom over the lookback window at any realistic
    // scrape cadence (hourly ebay/grailed/vestiaire, 3h poshmark per
    // fashion-monitor-run-and-operate) — enough rows to find the latest
    // success even if several recent attempts errored in a row.
    const recentRuns = runsRepo.recentFunnel(30);
    const result = evaluateScraperStaleness(recentRuns, new Date(), maxHours);

    if (!result.stale) {
      log.info(LogEvents.CliScraperHealthOk, {
        profileId: config.profile_id,
        hoursSinceLastSuccess: result.hoursSinceLastSuccess,
      });
      console.log(`OK — ${result.summary}`);
      return;
    }

    log.error(LogEvents.CliScraperHealthStale, {
      profileId: config.profile_id,
      maxHours,
      lastSuccessAt: result.lastSuccessAt,
      lastRunAt: result.lastRunAt,
    });
    console.error(`STALE — ${result.summary}`);

    const sent = await publishStaleAlert(
      config.alert.ntfy_url,
      config.alert.ntfy_topic,
      config.alert.ntfy_token,
      result.summary,
    );
    if (!sent) {
      log.error(LogEvents.CliScraperHealthAlertFailed, { profileId: config.profile_id });
      console.error("Additionally failed to publish the ntfy alert — see logs above.");
    }

    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  log.error(LogEvents.CliRunFailed, {
    error: err instanceof Error ? err.message : "unknown",
  });
  console.error(err);
  process.exit(1);
});
