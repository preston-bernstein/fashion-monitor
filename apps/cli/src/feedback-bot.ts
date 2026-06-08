#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "@fm/core/storage/db.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { loadCliConfig } from "./config.js";
import { fetchWithTimeout } from "@fm/core/lib/http.js";
import { FeedbackBotStateRepo, FeedbackRepo } from "@fm/core/storage/repos/feedback.js";
import { AlertLogRepo } from "@fm/core/storage/repos/alert-log.js";
import { processFeedbackUpdate, type FeedbackCallbackUpdate } from "@fm/core/alerts/feedback-handler.js";
import { IntegrationHealthRepo } from "@fm/core/storage/repos/integration-health.js";
import { recordFeedbackPoll } from "@fm/core/pipeline/integration-events.js";

const log = createLogger("cli.feedback-bot");
const POLL_INTERVAL_MS = 30_000;

type TelegramUpdate = FeedbackCallbackUpdate;

interface GetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

async function pollFeedbackBot(configPath: string): Promise<void> {
  const config = loadCliConfig(configPath);
  const db = openDatabase(config.database.path);
  const feedbackRepo = new FeedbackRepo(db, config.profile_id);
  const alertLogRepo = new AlertLogRepo(db, config.profile_id);
  const stateRepo = new FeedbackBotStateRepo(db);
  const integrationHealthRepo = new IntegrationHealthRepo(db, config.profile_id);
  const token = config.alert.telegram_bot_token;
  const baseUrl = `https://api.telegram.org/bot${token}`;

  log.info(LogEvents.CliFeedbackBotStart, { profileId: config.profile_id });

  while (true) {
    try {
      const offset = stateRepo.getOffset();
      const response = await fetchWithTimeout(`${baseUrl}/getUpdates?timeout=25&offset=${offset}`, {
        timeoutMs: 35_000,
      });
      const data = (await response.json()) as GetUpdatesResponse;

      if (data.ok) {
        recordFeedbackPoll(integrationHealthRepo, true, new Date().toISOString());
        for (const update of data.result) {
          stateRepo.setOffset(update.update_id + 1);

          const handled = processFeedbackUpdate(update, {
            feedbackRepo,
            alertLogRepo,
            answerCallback: async (callbackQueryId) => {
              await fetchWithTimeout(`${baseUrl}/answerCallbackQuery`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  callback_query_id: callbackQueryId,
                  text: "Got it — I'll learn from this.",
                }),
              });
            },
          });

          if (handled) {
            const parsed = update.callback_query?.data;
            log.info(LogEvents.CliFeedbackBotRecorded, { callback_data: parsed });
          }
        }
      } else {
        recordFeedbackPoll(
          integrationHealthRepo,
          false,
          new Date().toISOString(),
          "getUpdates returned ok=false",
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      recordFeedbackPoll(integrationHealthRepo, false, new Date().toISOString(), message);
      log.error(LogEvents.CliFeedbackBotPollError, { error: message });
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  log.info(LogEvents.CliStartup, { command: "feedback-bot" });
  const configPath = process.argv.includes("--config")
    ? process.argv[process.argv.indexOf("--config") + 1]
    : "config.yaml";

  if (!existsSync(resolve(configPath))) {
    log.error(LogEvents.CliConfigMissing, { path: resolve(configPath) });
    process.exit(1);
  }

  await pollFeedbackBot(configPath);
}

main().catch((err) => {
  log.error(LogEvents.CliRunFailed, {
    error: err instanceof Error ? err.message : "unknown",
  });
  process.exit(1);
});
