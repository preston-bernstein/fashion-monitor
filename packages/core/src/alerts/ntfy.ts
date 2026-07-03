import type { AlertConfig } from "../core/config.js";
import type { ScoredListing } from "../core/types.js";
import type { Platform } from "../core/types.js";
import { fetchWithTimeout } from "../lib/http.js";
import { LogEvents } from "../lib/log-events.js";
import { createLogger } from "../lib/logging.js";

const log = createLogger("alerts.ntfy");

const PLATFORM_LABELS: Record<Platform, string> = {
  ebay: "eBay",
  grailed: "Grailed",
  vestiaire: "Vestiaire",
  vinted: "Vinted",
  depop: "Depop",
  poshmark: "Poshmark",
};

export interface AlertClient {
  sendAlert(scored: ScoredListing): Promise<boolean>;
  sendDigest(matches: ScoredListing[]): Promise<boolean>;
  sendEmptyRunNotice(): Promise<boolean>;
}

interface NtfyPublishPayload {
  title: string;
  message: string;
  priority: number;
  tags?: string[];
  click?: string;
  attach?: string;
}

export class NtfyAlerter implements AlertClient {
  constructor(private readonly config: AlertConfig) {}

  // Published as JSON (not headers) because ntfy's header-based publish API
  // requires ASCII-only header values — the ✅/🟡 icons below would throw
  // "Cannot convert argument to a ByteString" on Node's real fetch.
  private async publish(payload: NtfyPublishPayload): Promise<boolean> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.ntfy_token) {
      headers["Authorization"] = `Bearer ${this.config.ntfy_token}`;
    }

    try {
      const response = await fetchWithTimeout(this.config.ntfy_url, {
        method: "POST",
        headers,
        body: JSON.stringify({ topic: this.config.ntfy_topic, ...payload }),
      });
      if (!response.ok) {
        log.error(LogEvents.AlertsSendFailed, { status: response.status });
      }
      return response.ok;
    } catch (err) {
      log.error(LogEvents.AlertsSendError, {
        error: err instanceof Error ? err.message : "unknown",
      });
      return false;
    }
  }

  async sendAlert(scored: ScoredListing): Promise<boolean> {
    const { listing, result } = scored;
    const isYes = result.score === "YES";
    const icon = isYes ? "✅" : "🟡";
    const label = PLATFORM_LABELS[listing.platform];
    const brand = listing.brand ?? listing.title.split(" ").slice(0, 2).join(" ");

    const q = result.quality === "pass" ? "✓" : result.quality === "fail" ? "✗" : "?";
    const v = result.value === "pass" ? "✓" : result.value === "fail" ? "✗" : "?";
    const a = result.aesthetic === "pass" ? "✓" : result.aesthetic === "fail" ? "✗" : "?";

    const title = `${icon} ${brand} — $${listing.price.toFixed(0)} · ${label}`;
    const message = [
      `Quality ${q}  Value ${v}  Aesthetic ${a}  Size: ${result.size.toLowerCase()}`,
      `"${result.reason}"`,
    ].join("\n");

    return this.publish({
      title,
      message,
      priority: isYes ? 4 : 3,
      tags: [isYes ? "white_check_mark" : "warning"],
      click: listing.url,
      attach: listing.imageUrl ?? undefined,
    });
  }

  async sendDigest(matches: ScoredListing[]): Promise<boolean> {
    const title = `Fashion Monitor — ${matches.length} match${matches.length === 1 ? "" : "es"}`;
    const message = matches
      .map((m) => {
        const label = PLATFORM_LABELS[m.listing.platform];
        return `[${m.result.score}] ${m.listing.title} — $${m.listing.price.toFixed(0)} (${label})\n${m.listing.url}`;
      })
      .join("\n\n");

    return this.publish({ title, message, priority: 3, tags: ["shirt"] });
  }

  async sendEmptyRunNotice(): Promise<boolean> {
    return this.publish({
      title: "Fashion Monitor — no matches this run",
      message: "No new matches found.",
      priority: 2,
    });
  }
}

export function createNtfyAlerter(config: AlertConfig): AlertClient {
  return new NtfyAlerter(config);
}
