import type { Platform } from "../core/types.js";
import { LogEvents } from "../lib/log-events.js";
import { createLogger } from "../lib/logging.js";
import type { PlatformScraper, ScrapeOutcome } from "../platforms/types.js";
import type { IntegrationHealthRepo } from "../storage/repos/integration-health.js";

const log = createLogger("pipeline.integration");

function recordEvent(
  repo: IntegrationHealthRepo,
  entry: Parameters<IntegrationHealthRepo["record"]>[0],
  runId?: number,
): void {
  repo.record(entry);
  const child = runId !== undefined ? log.child({ runId }) : log;
  child.debug(LogEvents.IntegrationEventRecorded, {
    integration: entry.integration,
    operation: entry.operation,
    status: entry.status,
    error: entry.error ?? undefined,
    durationMs: entry.durationMs,
  });
}

export function recordScrapeOutcomes(
  repo: IntegrationHealthRepo,
  scrapers: PlatformScraper[],
  outcomes: ScrapeOutcome[],
  runId: number,
  recordedAt: string,
): void {
  outcomes.forEach((result, index) => {
    const platform = scrapers[index]?.platform ?? ("unknown" as Platform);
    const integration = `scraper:${platform}`;

    if (result.ok) {
      const failedQueries = result.queryResults.filter((q) => !q.ok);
      if (failedQueries.length === 0) {
        recordEvent(
          repo,
          {
            integration,
            operation: "scrape",
            status: "ok",
            runId,
            recordedAt,
          },
          runId,
        );
      } else {
        recordEvent(
          repo,
          {
            integration,
            operation: "scrape",
            status: "degraded",
            error: `${failedQueries.length}/${result.queryResults.length} queries failed`,
            runId,
            recordedAt,
          },
          runId,
        );
        for (const query of failedQueries) {
          recordEvent(
            repo,
            {
              integration: `scraper:${platform}:${query.queryId}`,
              operation: "scrape_query",
              status: "fail",
              error: query.error ?? "query scrape failed",
              runId,
              recordedAt,
            },
            runId,
          );
        }
      }
      return;
    }

    recordEvent(
      repo,
      {
        integration,
        operation: "scrape",
        status: "fail",
        error: result.error,
        runId,
        recordedAt,
      },
      runId,
    );

    for (const query of result.queryResults.filter((q) => !q.ok)) {
      recordEvent(
        repo,
        {
          integration: `scraper:${platform}:${query.queryId}`,
          operation: "scrape_query",
          status: "fail",
          error: query.error ?? result.error,
          runId,
          recordedAt,
        },
        runId,
      );
    }
  });
}

export async function recordTimedHealthCheck(
  repo: IntegrationHealthRepo,
  integration: string,
  check: () => Promise<boolean>,
  runId: number,
  recordedAt: string,
): Promise<boolean> {
  const started = Date.now();
  const ok = await check();
  recordEvent(
    repo,
    {
      integration,
      operation: "health_check",
      status: ok ? "ok" : "fail",
      error: ok ? null : "health check returned false",
      durationMs: Date.now() - started,
      runId,
      recordedAt,
    },
    runId,
  );
  return ok;
}

export function recordAlertDelivery(
  repo: IntegrationHealthRepo,
  operation: "send_alert" | "send_digest" | "send_empty_notice",
  sent: boolean,
  runId: number,
  recordedAt: string,
  error?: string,
): void {
  recordEvent(
    repo,
    {
      integration: "alerts:telegram",
      operation,
      status: sent ? "ok" : "fail",
      error: sent ? null : (error ?? "telegram send returned false"),
      runId,
      recordedAt,
    },
    runId,
  );
}

export function recordFeedbackPoll(
  repo: IntegrationHealthRepo,
  ok: boolean,
  recordedAt: string,
  error?: string,
): void {
  recordEvent(repo, {
    integration: "feedback:telegram",
    operation: "poll_updates",
    status: ok ? "ok" : "fail",
    error: ok ? null : error,
    recordedAt,
  });
}

export function recordPipelineFailure(
  repo: IntegrationHealthRepo,
  error: string,
  runId: number,
  recordedAt: string,
): void {
  recordEvent(
    repo,
    {
      integration: "pipeline:run",
      operation: "execute",
      status: "fail",
      error,
      runId,
      recordedAt,
    },
    runId,
  );
}
