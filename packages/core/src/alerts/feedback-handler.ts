import { buildFeedbackInsert } from "./feedback-record.js";
import { parseFeedbackCallback } from "./format.js";
import type { FeedbackRepo } from "../storage/repos/feedback.js";
import type { AlertLogRepo } from "../storage/repos/alert-log.js";

export interface FeedbackCallbackUpdate {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      caption?: string;
      text?: string;
    };
  };
}

export interface FeedbackHandlerDeps {
  feedbackRepo: FeedbackRepo;
  alertLogRepo: AlertLogRepo;
  answerCallback: (callbackQueryId: string) => Promise<void>;
}

export function processFeedbackUpdate(
  update: FeedbackCallbackUpdate,
  deps: FeedbackHandlerDeps,
): boolean {
  const callback = update.callback_query;
  if (!callback?.data) return false;

  const parsed = parseFeedbackCallback(callback.data);
  if (!parsed) return false;

  deps.feedbackRepo.insert(
    buildFeedbackInsert(
      {
        platform: parsed.platform,
        listing_id: parsed.listingId,
        signal: parsed.signal,
        caption: callback.message?.caption ?? callback.message?.text ?? null,
      },
      deps.alertLogRepo,
    ),
    new Date().toISOString(),
  );

  void deps.answerCallback(callback.id);
  return true;
}
