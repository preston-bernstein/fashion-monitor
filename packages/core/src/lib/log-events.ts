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
  IntegrationEventRecorded: "pipeline.integration.recorded",

  // Platforms
  PlatformScrapeSuccess: "platform.scrape.success",
  PlatformScrapeFailed: "platform.scrape.failed",
  PlatformQueryFailed: "platform.query.failed",
  PlatformDepopRscSuccess: "platform.depop.rsc.success",
  PlatformDepopHttpFailed: "platform.depop.http.failed",
  PlatformGrailedCredentialsValid: "platform.grailed.credentials.valid",
  PlatformVestiaireFetchBlocked: "platform.vestiaire.fetch.blocked",

  // Alerts
  AlertsTelegramSendFailed: "alerts.telegram.send.failed",
  AlertsTelegramSendError: "alerts.telegram.send.error",

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
  CliFeedbackBotStart: "cli.feedback-bot.start",
  CliFeedbackBotPoll: "cli.feedback-bot.poll",
  CliFeedbackBotRecorded: "cli.feedback-bot.recorded",
  CliFeedbackBotPollError: "cli.feedback-bot.poll.error",
  CliReportComplete: "cli.report.complete",
} as const;

export type LogEventId = (typeof LogEvents)[keyof typeof LogEvents];
