import type { ScoredListing, ScoringResult } from "../core/types.js";
import type { Platform } from "../core/types.js";

const PLATFORM_LABELS: Record<Platform, string> = {
  ebay: "eBay",
  grailed: "Grailed",
  vestiaire: "Vestiaire",
  vinted: "Vinted",
  depop: "Depop",
  poshmark: "Poshmark",
};

function dimensionLine(result: ScoringResult): string {
  const q = result.quality === "pass" ? "✓" : result.quality === "fail" ? "✗" : "?";
  const v = result.value === "pass" ? "✓" : result.value === "fail" ? "✗" : "?";
  const a = result.aesthetic === "pass" ? "✓" : result.aesthetic === "fail" ? "✗" : "?";
  return `Quality ${q}  Value ${v}  Aesthetic ${a}  Size: ${result.size.toLowerCase()}`;
}

export function formatImmediateAlert(scored: ScoredListing): string {
  const { listing, result } = scored;
  const label = PLATFORM_LABELS[listing.platform];
  const icon = result.score === "YES" ? "✅ YES" : "🟡 MAYBE";

  const lines = [
    `[${label}] ${icon}`,
    "",
    `${listing.brand ?? "Unknown Brand"} — ${listing.title}`,
    `$${listing.price.toFixed(0)} · ${listing.condition ?? "—"} · ${listing.size || "—"}`,
    "",
    dimensionLine(result),
    `"${result.reason}"`,
    "",
    listing.url,
  ];

  return lines.join("\n");
}

export function formatDigestAlert(matches: ScoredListing[]): string {
  const header = `Fashion Monitor — ${matches.length} match${matches.length === 1 ? "" : "es"} found\n`;
  const body = matches
    .map((m, i) => {
      const label = PLATFORM_LABELS[m.listing.platform];
      return `${i + 1}. [${m.result.score}] ${m.listing.title} — $${m.listing.price.toFixed(0)} (${label})\n   ${m.result.reason}\n   ${m.listing.url}`;
    })
    .join("\n\n");
  return header + "\n" + body;
}

export function feedbackCallbackData(
  platform: string,
  listingId: string,
  signal: "positive" | "negative",
): string {
  return `fb:${platform}:${listingId}:${signal}`;
}

export function parseFeedbackCallback(data: string): {
  platform: Platform;
  listingId: string;
  signal: "positive" | "negative";
} | null {
  const match = /^fb:([^:]+):([^:]+):(positive|negative)$/.exec(data);
  if (!match) return null;
  return {
    platform: match[1] as Platform,
    listingId: match[2],
    signal: match[3] as "positive" | "negative",
  };
}
