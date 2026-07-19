import type { Config } from "../core/config.js";
import type { Listing, Platform, RunStats } from "../core/types.js";
import { allPlatformSearches } from "../config/searches.js";
import { createProviderFromConfig } from "../llm/factory.js";
import type { LLMProvider } from "../llm/provider.js";
import { LogEvents } from "../lib/log-events.js";
import { createLogger, withRunContext } from "../lib/logging.js";
import { createNtfyAlerter } from "../alerts/ntfy.js";
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
import { SearchGroupsRepo } from "../storage/repos/search-groups.js";
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
      runLog.warn(LogEvents.PlatformScrapeFailed, {
        platform: scraper.platform,
        error: result.error,
      });
    }
  });

  return { listings, errors, queryResults, scrapeOutcomes: results };
}

/**
 * Scrape-only phase: scrapeAll -> dedupe -> prefilter -> mark passed listings
 * PENDING. Never touches the LLM provider, so this is the half of the
 * pipeline safe to run inside a network-isolated (e.g. VPN-tunneled)
 * container. Reuses seen_listings' existing PENDING state — previously only
 * reached when the LLM health check failed mid-`runPipeline`; here it's the
 * standard hand-off point to `runScorePhase`, run as a separate invocation.
 *
 * Deliberately NOT extracted as a shared helper with `runPipeline` above —
 * `runPipeline` remains the frozen, heavily-tested combined path for local
 * dev / non-split deployments. This duplicates its scrape+dedupe+prefilter
 * section rather than risk destabilizing that path's existing test coverage.
 */
export async function runScrapePhase(ctx: RunContext): Promise<RunStats> {
  const now = ctx.now ?? new Date();
  const nowIso = now.toISOString();
  const config = ctx.config;
  const profileId = config.profile_id;

  const seenRepo = new SeenListingsRepo(ctx.db, profileId);
  const runsRepo = new RunsRepo(ctx.db, profileId);
  const scrapeQueriesRepo = new ScrapeQueriesRepo(ctx.db, profileId);
  const searchGroupsRepo = new SearchGroupsRepo(ctx.db, profileId);
  const configRevisionsRepo = new ConfigRevisionsRepo(ctx.db, profileId);
  const integrationHealthRepo = new IntegrationHealthRepo(ctx.db, profileId);

  seenRepo.pruneOlderThan(90, now);
  runsRepo.pruneOlderThan(30, now);
  integrationHealthRepo.pruneOlderThan(30, now);

  searchGroupsRepo.syncFromConfig(config, nowIso);
  const runId = runsRepo.start(nowIso);
  configRevisionsRepo.maybeSnapshot(config, runId, nowIso);

  log.info(LogEvents.PipelineRunStart, { runId, profileId, phase: "scrape" });

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

      for (const listing of passed) {
        seenRepo.markPending(listing, nowIso);
      }
      runLog.info(LogEvents.PipelineScrapePhaseComplete, { profileId, pending: passed.length });

      scrapeQueriesRepo.recordQueryRuns(runId, queryTracker.toArray());
      runsRepo.finish(runId, new Date().toISOString(), stats, stats.errors.join("; ") || null);
      runLog.info(LogEvents.PipelineRunComplete, {
        profileId,
        ...stats,
        dbSkipped,
        phase: "scrape",
      });
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
    log.error(LogEvents.PipelineRunFailed, { runId, profileId, error: message, phase: "scrape" });
    throw err;
  }
}

/**
 * Score-only phase: health-check the LLM provider, pick up whatever
 * `runScrapePhase` (or `runPipeline`) left PENDING, score it, dispatch
 * alerts. No scraping happens here, so this phase never needs marketplace
 * network access — it's the half that needs the Ollama broker instead, and
 * so stays OUTSIDE any VPN-tunneled network namespace.
 *
 * Note: unlike `runPipeline`, this does not write to `scrape_queries` — a
 * score-only invocation has no `queryResults` of its own (the PENDING
 * backlog it scores may span several earlier scrape runs' queries), so
 * per-query scored/alerted attribution is not reconstructed here. Only this
 * phase's own `runs` row (aggregate scoredYes/Maybe/No/alertsSent) reflects
 * what happened. Named plainly rather than faked: query-level funnel detail
 * for a listing scored in this phase stays attributed to its original
 * scrape run's query rows for new/prefilterRejected only.
 */
export async function runScorePhase(ctx: RunContext): Promise<RunStats> {
  const now = ctx.now ?? new Date();
  const nowIso = now.toISOString();
  const config = ctx.config;
  const profileId = config.profile_id;

  const seenRepo = new SeenListingsRepo(ctx.db, profileId);
  const feedbackRepo = new FeedbackRepo(ctx.db, profileId);
  const alertLogRepo = new AlertLogRepo(ctx.db, profileId);
  const runsRepo = new RunsRepo(ctx.db, profileId);
  const integrationHealthRepo = new IntegrationHealthRepo(ctx.db, profileId);

  runsRepo.pruneOlderThan(30, now);
  integrationHealthRepo.pruneOlderThan(30, now);

  const runId = runsRepo.start(nowIso);
  log.info(LogEvents.PipelineRunStart, { runId, profileId, phase: "score" });

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

  try {
    return await withRunContext(runId, async () => {
      const runLog = log.child({ runId });
      const provider = ctx.provider ?? createProviderFromConfig(config.llm);
      const healthy = await recordTimedHealthCheck(
        integrationHealthRepo,
        `llm:${config.llm.provider}`,
        () => provider.healthCheck(),
        runId,
        nowIso,
      );

      if (!healthy) {
        runLog.warn(LogEvents.PipelineLlmUnavailable, { pending: 0 });
        runsRepo.finish(runId, new Date().toISOString(), stats, stats.errors.join("; ") || null);
        return stats;
      }

      const pendingBacklog = seenRepo.fetchPendingListings();
      if (pendingBacklog.length > 0) {
        runLog.info(LogEvents.PipelinePendingBacklog, { count: pendingBacklog.length });
      }

      const scoreResult = await scoreListings(pendingBacklog, config, provider, feedbackRepo);
      stats.scoredYes = scoreResult.yes.length;
      stats.scoredMaybe = scoreResult.maybe.length;
      stats.scoredNo = scoreResult.no.length;

      for (const { listing, result } of scoreResult.scored) {
        seenRepo.recordScore(listing, result.score, nowIso);
      }

      const alertable = filterAlertable(scoreResult.scored);
      const alerter = createNtfyAlerter(config.alert);

      if (config.alert.mode === "digest") {
        if (alertable.length > 0) {
          const sent = await alerter.sendDigest(alertable);
          recordAlertDelivery(integrationHealthRepo, "send_digest", sent, runId, nowIso);
          if (sent) {
            stats.alertsSent = alertable.length;
            recordAlertsSent(alertable, alertLogRepo, seenRepo, nowIso);
          }
        }
      } else {
        for (const scored of alertable) {
          const sent = await alerter.sendAlert(scored);
          recordAlertDelivery(integrationHealthRepo, "send_alert", sent, runId, nowIso);
          if (sent) {
            stats.alertsSent++;
            recordAlertSent(scored, alertLogRepo, seenRepo, nowIso);
          }
        }
      }

      if (config.alert.notify_empty && alertable.length === 0) {
        const sent = await alerter.sendEmptyRunNotice();
        recordAlertDelivery(integrationHealthRepo, "send_empty_notice", sent, runId, nowIso);
      }

      runsRepo.finish(runId, new Date().toISOString(), stats, stats.errors.join("; ") || null);
      runLog.info(LogEvents.PipelineRunComplete, { profileId, ...stats, phase: "score" });
      return stats;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown pipeline error";
    stats.errors.push(message);
    recordPipelineFailure(integrationHealthRepo, message, runId, new Date().toISOString());
    runsRepo.finish(runId, new Date().toISOString(), stats, message);
    log.error(LogEvents.PipelineRunFailed, { runId, profileId, error: message, phase: "score" });
    throw err;
  }
}

export async function runPipeline(ctx: RunContext): Promise<RunStats> {
  const now = ctx.now ?? new Date();
  const nowIso = now.toISOString();
  const config = ctx.config;
  const profileId = config.profile_id;

  const seenRepo = new SeenListingsRepo(ctx.db, profileId);
  const feedbackRepo = new FeedbackRepo(ctx.db, profileId);
  const alertLogRepo = new AlertLogRepo(ctx.db, profileId);
  const runsRepo = new RunsRepo(ctx.db, profileId);
  const scrapeQueriesRepo = new ScrapeQueriesRepo(ctx.db, profileId);
  const searchGroupsRepo = new SearchGroupsRepo(ctx.db, profileId);
  const configRevisionsRepo = new ConfigRevisionsRepo(ctx.db, profileId);
  const integrationHealthRepo = new IntegrationHealthRepo(ctx.db, profileId);

  seenRepo.pruneOlderThan(90, now);
  runsRepo.pruneOlderThan(30, now);
  integrationHealthRepo.pruneOlderThan(30, now);

  searchGroupsRepo.syncFromConfig(config, nowIso);
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
      const alerter = createNtfyAlerter(config.alert);

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
