/** Stable dotted event ids — keep in sync with docs/logging-and-audit.md */

export const LogEvents = {
  // Pipeline
  PipelineRunStart: "pipeline.run.start",
  PipelineRunComplete: "pipeline.run.complete",
  PipelineRunFailed: "pipeline.run.failed",
  PipelinePrefilterRejected: "pipeline.prefilter.rejected",
  PipelineLlmUnavailable: "pipeline.llm.unavailable",
  PipelinePendingBacklog: "pipeline.pending.backlog",
  PipelineScorerBatchStart: "pipeline.scorer.batch.start",
  PipelineScorerVisionStart: "pipeline.scorer.vision.start",
  PipelineScorerVisionFlip: "pipeline.scorer.vision.flip",
  IntegrationEventRecorded: "pipeline.integration.recorded",

  // Platforms
  PlatformScrapeSuccess: "platform.scrape.success",
  PlatformScrapeFailed: "platform.scrape.failed",
  PlatformQuerySuccess: "platform.query.success",
  PlatformQueryFailed: "platform.query.failed",
  PlatformDepopRscSuccess: "platform.depop.rsc.success",
  PlatformDepopHttpFailed: "platform.depop.http.failed",
  PlatformEbayOAuthFailed: "platform.ebay.oauth.failed",
  PlatformGrailedCredentialsValid: "platform.grailed.credentials.valid",
  PlatformVestiaireFetchBlocked: "platform.vestiaire.fetch.blocked",

  // Alerts
  AlertsSendFailed: "alerts.send.failed",
  AlertsSendError: "alerts.send.error",

  // Web
  WebAuthLogin: "web.auth.login",
  WebAuthLoginFailed: "web.auth.login.failed",
  WebAuthLogout: "web.auth.logout",
  WebRequestComplete: "web.request.complete",
  WebCsrfFailed: "web.auth.csrf.failed",

  // CLI
  CliStartup: "cli.startup",
  CliConfigLoaded: "cli.config.loaded",
  CliConfigMissing: "cli.config.missing",
  CliRunComplete: "cli.run.complete",
  CliRunFailed: "cli.run.failed",
  CliDashboardStarted: "cli.dashboard.started",
  CliDashboardFailed: "cli.dashboard.failed",
  CliReportComplete: "cli.report.complete",
} as const;

export type LogEventId = (typeof LogEvents)[keyof typeof LogEvents];
