import type { AlertConfig } from "../core/config.js";
import type { ScoredListing } from "../core/types.js";
import { fetchWithTimeout } from "../lib/http.js";
import { LogEvents } from "../lib/log-events.js";
import { createLogger } from "../lib/logging.js";
import { feedbackCallbackData, formatDigestAlert, formatImmediateAlert } from "./format.js";

const log = createLogger("alerts.telegram");

export interface TelegramClient {
  sendAlert(scored: ScoredListing): Promise<boolean>;
  sendDigest(matches: ScoredListing[]): Promise<boolean>;
  sendEmptyRunNotice(): Promise<boolean>;
}

export class TelegramAlerter implements TelegramClient {
  constructor(private readonly config: AlertConfig) {}

  private get baseUrl(): string {
    return `https://api.telegram.org/bot${this.config.telegram_bot_token}`;
  }

  private async post(method: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        log.error(LogEvents.AlertsTelegramSendFailed, { method, status: response.status });
        await new Promise((r) => setTimeout(r, 30_000));
        const retry = await fetchWithTimeout(`${this.baseUrl}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return retry.ok;
      }
      return true;
    } catch (err) {
      log.error(LogEvents.AlertsTelegramSendError, {
        method,
        error: err instanceof Error ? err.message : "unknown",
      });
      return false;
    }
  }

  private inlineKeyboard(scored: ScoredListing) {
    const { listing } = scored;
    return {
      inline_keyboard: [
        [
          {
            text: "✅ Good find",
            callback_data: feedbackCallbackData(listing.platform, listing.id, "positive"),
          },
          {
            text: "❌ Not for me",
            callback_data: feedbackCallbackData(listing.platform, listing.id, "negative"),
          },
        ],
      ],
    };
  }

  async sendAlert(scored: ScoredListing): Promise<boolean> {
    const caption = formatImmediateAlert(scored);
    const { listing } = scored;

    if (listing.imageUrl) {
      const ok = await this.post("sendPhoto", {
        chat_id: this.config.telegram_chat_id,
        photo: listing.imageUrl,
        caption,
        reply_markup: this.inlineKeyboard(scored),
      });
      await new Promise((r) => setTimeout(r, 100));
      return ok;
    }

    const ok = await this.post("sendMessage", {
      chat_id: this.config.telegram_chat_id,
      text: caption,
      reply_markup: this.inlineKeyboard(scored),
    });
    await new Promise((r) => setTimeout(r, 100));
    return ok;
  }

  async sendDigest(matches: ScoredListing[]): Promise<boolean> {
    return this.post("sendMessage", {
      chat_id: this.config.telegram_chat_id,
      text: formatDigestAlert(matches),
    });
  }

  async sendEmptyRunNotice(): Promise<boolean> {
    return this.post("sendMessage", {
      chat_id: this.config.telegram_chat_id,
      text: "Fashion Monitor — no matches this run.",
    });
  }
}

export function createTelegramAlerter(config: AlertConfig): TelegramClient {
  return new TelegramAlerter(config);
}
