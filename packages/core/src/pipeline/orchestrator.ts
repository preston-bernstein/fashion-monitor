import type { Config } from "../core/config.js";
import type { Listing, Platform, RunStats } from "../core/types.js";
import { allPlatformSearches } from "../config/searches.js";
import { createProviderFromConfig } from "../llm/factory.js";
import type { LLMProvider } from "../llm/provider.js";
import { LogEvents } from "../lib/log-events.js";
import { createLogger, withRunContext } from "../lib/logging.js";
import { createTelegramAlerter } from "../alerts/telegram.js";
import { recordAlertSent, recordAlertsSent } from "./alert-dispatch.js";
import { createScrapers } from "../platforms/registry.js";
import type { PlatformScraper, QueryScrapeResult, ScrapeOutcome } from "../platforms/types.js";
import {
  recordAlertDelivery,
  recordPipelineFailure,
  recordScrapeOutcomes,
  recordTimedHealthCheck,
} from "./integration-events.js";
import { dedupePipeline } from "./dedupe.js";
import { prefilterListings } from "./prefilter.js";
import { QueryRunTracker } from "./query-stats.js";
import { filterAlertable, scoreListings } from "./scorer.js";
import { mergeListings } from "../storage/listing-snapshot.js";
import type { Db } from "../storage/db.js";
import { AlertLogRepo } from "../storage/repos/alert-log.js";
import { ConfigRevisionsRepo } from "../storage/repos/config-revisions.js";
import { FeedbackRepo } from "../storage/repos/feedback.js";
import { RunsRepo } from "../storage/repos/runs.js";
import { IntegrationHealthRepo } from "../storage/repos/integration-health.js";
import { ScrapeQueriesRepo } from "../storage/repos/scrape-queries.js";
import { SeenListingsRepo } from "../storage/repos/seen-listings.js";

const log = createLogger("pipeline.orchestrator");

export interface RunContext {
  config: Config;
  db: Db;
  now?: Date;
  platformFilter?: Platform[];
  scrapers?: PlatformScraper[];
  provider?: LLMProvider;
}

export async function scrapeAll(
  scrapers: PlatformScraper[],
  queriesByPlatform: Map<Platform, import("../config/searches.js").SearchRequest[]>,
  runId?: number,
): Promise<{
  listings: Listing[];
  errors: string[];
  queryResults: QueryScrapeResult[];
  scrapeOutcomes: ScrapeOutcome[];
}> {
  const runLog = runId !== undefined ? log.child({ runId }) : log;
  const results = await Promise.all(
    scrapers.map((s) => s.search(queriesByPlatform.get(s.platform) ?? [])),
  );
  const listings: Listing[] = [];
  const errors: string[] = [];
  const queryResults: QueryScrapeResult[] = [];

  results.forEach((result, i) => {
    const scraper = scrapers[i];
    queryResults.push(...result.queryResults);
    if (result.ok) {
      listings.push(...result.listings);
      runLog.info(LogEvents.PlatformScrapeSuccess, {
        platform: scraper.platform,
        count: result.listings.length,
        queries: result.queryResults.length,
      });
    } else {
      errors.push(`${scraper.platform}: ${result.error}`);
      runLog.warn(LogEvents.PlatformScrapeFailed, { platform: scraper.platform, error: result.error });
    }
  });

  return { listings, errors, queryResults, scrapeOutcomes: results };
}

export async function runPipeline(ctx: RunContext): Promise<RunStats> {
  const now = ctx.now ?? new Date();
  const nowIso = now.toISOString();
  const config = ctx.config;
  const profileId = config.profile_id;

  const seenRepo = new SeenListingsRepo(ctx.db, profileId);
  const feedbackRepo = new FeedbackRepo(ctx.db, profileId);
  const alertLogRepo = new AlertLogRepo(ctx.db, profileId);
  const runsRepo = new RunsRepo(ctx.db);
  const scrapeQueriesRepo = new ScrapeQueriesRepo(ctx.db, profileId);
  const configRevisionsRepo = new ConfigRevisionsRepo(ctx.db, profileId);
  const integrationHealthRepo = new IntegrationHealthRepo(ctx.db, profileId);

  seenRepo.pruneOlderThan(90, now);
  runsRepo.pruneOlderThan(30, now);
  integrationHealthRepo.pruneOlderThan(30, now);

  scrapeQueriesRepo.syncFromConfig(config, nowIso);
  const runId = runsRepo.start(nowIso);
  configRevisionsRepo.maybeSnapshot(config, runId, nowIso);

  log.info(LogEvents.PipelineRunStart, { runId, profileId });

  const stats: RunStats = {
    listingsFound: 0,
    listingsNew: 0,
    scoredYes: 0,
    scoredMaybe: 0,
    scoredNo: 0,
    alertsSent: 0,
    prefilterRejected: 0,
    errors: [],
  };

  let queryTracker: QueryRunTracker | undefined;

  try {
    return await withRunContext(runId, async () => {
    const scrapers = ctx.scrapers ?? createScrapers(config, ctx.platformFilter);
    const queriesByPlatform = allPlatformSearches(config);
    const runLog = log.child({ runId });
    const { listings, errors, queryResults, scrapeOutcomes } = await scrapeAll(
      scrapers,
      queriesByPlatform,
      runId,
    );
    recordScrapeOutcomes(integrationHealthRepo, scrapers, scrapeOutcomes, runId, nowIso);
    queryTracker = new QueryRunTracker(queryResults);

    stats.listingsFound = listings.length;
    stats.errors.push(...errors);

    const { listings: deduped, dbSkipped } = dedupePipeline(listings, seenRepo);
    stats.listingsNew = deduped.length;
    for (const listing of deduped) {
      queryTracker.recordNew(listing);
    }

    const { passed, rejected } = prefilterListings(deduped, config);
    stats.prefilterRejected = rejected.length;

    for (const { listing, reason } of rejected) {
      queryTracker.recordPrefilterRejected(listing);
      seenRepo.markSeen(listing, "NO", nowIso);
      runLog.info(LogEvents.PipelinePrefilterRejected, {
        platform: listing.platform,
        queryId: listing.sourceQueryId,
        id: listing.id,
        reason,
      });
    }

    const provider = ctx.provider ?? createProviderFromConfig(config.llm);
    const healthy = await recordTimedHealthCheck(
      integrationHealthRepo,
      `llm:${config.llm.provider}`,
      () => provider.healthCheck(),
      runId,
      nowIso,
    );

    if (!healthy) {
      for (const listing of passed) {
        seenRepo.markPending(listing, nowIso);
      }
      runLog.warn(LogEvents.PipelineLlmUnavailable, { pending: passed.length });
      scrapeQueriesRepo.recordQueryRuns(runId, queryTracker.toArray());
      runsRepo.finish(runId, new Date().toISOString(), stats, stats.errors.join("; ") || null);
      return stats;
    }

    const pendingBacklog = seenRepo.fetchPendingListings();
    if (pendingBacklog.length > 0) {
      runLog.info(LogEvents.PipelinePendingBacklog, { count: pendingBacklog.length });
    }

    const toScore = mergeListings(pendingBacklog, passed);
    const scoreResult = await scoreListings(toScore, config, provider, feedbackRepo);
    stats.scoredYes = scoreResult.yes.length;
    stats.scoredMaybe = scoreResult.maybe.length;
    stats.scoredNo = scoreResult.no.length;

    for (const { listing, result } of scoreResult.scored) {
      queryTracker.recordScore(listing, result.score);
      seenRepo.recordScore(listing, result.score, nowIso);
    }

    const alertable = filterAlertable(scoreResult.scored);
    const alerter = createTelegramAlerter(config.alert);

    if (config.alert.mode === "digest") {
      if (alertable.length > 0) {
        const sent = await alerter.sendDigest(alertable);
        recordAlertDelivery(integrationHealthRepo, "send_digest", sent, runId, nowIso);
        if (sent) {
          stats.alertsSent = alertable.length;
          for (const scored of alertable) {
            queryTracker.recordAlert(scored.listing);
          }
          recordAlertsSent(alertable, alertLogRepo, seenRepo, nowIso);
        }
      }
    } else {
      for (const scored of alertable) {
        const sent = await alerter.sendAlert(scored);
        recordAlertDelivery(integrationHealthRepo, "send_alert", sent, runId, nowIso);
        if (sent) {
          stats.alertsSent++;
          queryTracker.recordAlert(scored.listing);
          recordAlertSent(scored, alertLogRepo, seenRepo, nowIso);
        }
      }
    }

    if (config.alert.notify_empty && alertable.length === 0) {
      const sent = await alerter.sendEmptyRunNotice();
      recordAlertDelivery(integrationHealthRepo, "send_empty_notice", sent, runId, nowIso);
    }

    scrapeQueriesRepo.recordQueryRuns(runId, queryTracker.toArray());
    runsRepo.finish(runId, new Date().toISOString(), stats, stats.errors.join("; ") || null);
    runLog.info(LogEvents.PipelineRunComplete, { profileId, ...stats, dbSkipped });
    return stats;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown pipeline error";
    stats.errors.push(message);
    recordPipelineFailure(integrationHealthRepo, message, runId, new Date().toISOString());
    if (queryTracker) {
      scrapeQueriesRepo.recordQueryRuns(runId, queryTracker.toArray());
    }
    runsRepo.finish(runId, new Date().toISOString(), stats, message);
    log.error(LogEvents.PipelineRunFailed, { runId, profileId, error: message });
    throw err;
  }
}
