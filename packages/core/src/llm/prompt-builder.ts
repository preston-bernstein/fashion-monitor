import type { Config } from "../core/config.js";
import type { FeedbackRow, PreparedListing } from "../core/types.js";
import type { FeedbackRepo } from "../storage/repos/feedback.js";
import { SCORING_RUBRIC, formatPositiveSignals } from "./prompt-template.js";

export function formatMeasurements(config: Config): string {
  const m = config.measurements;
  const parts: string[] = [];
  if (m.height) parts.push(`Height: ${m.height}`);
  if (m.weight_lbs) parts.push(`Weight: ~${m.weight_lbs} lbs`);
  if (m.chest_in) parts.push(`Chest: ~${m.chest_in}"`);
  if (m.waist_in)
    parts.push(`Waist: ~${m.waist_in}" actual (wears ${m.pants_size ?? "40-42"} pants)`);
  if (m.typical_size) parts.push(`Typical size: ${m.typical_size} tops`);
  if (m.dress_shirt_neck) {
    parts.push(`Dress shirt: ${m.dress_shirt_neck}" neck / ${m.dress_shirt_sleeve ?? "?"} sleeve`);
  }
  return parts.join(". ");
}

function formatFeedbackExamples(rows: FeedbackRow[], label: string): string {
  if (rows.length === 0) return "";
  const lines = rows.map(
    (f) =>
      `- [${f.brand ?? "Unknown"}] ${(f.title ?? "").slice(0, 80)} — ${(f.description ?? "").slice(0, 100)}`,
  );
  return `${label}\n${lines.join("\n")}`;
}

export function buildSystemPrompt(config: Config, feedbackRepo: FeedbackRepo): string {
  const positives = feedbackRepo.fetchRecent("positive", 15);
  const negatives = feedbackRepo.fetchRecent("negative", 15);

  let prompt = `${SCORING_RUBRIC}

## Buyer measurements
${formatMeasurements(config)}

## User aesthetic (primary style guide)
${config.aesthetic_prompt}

## Additional positive signals from config
${formatPositiveSignals(config)}

## Hard NO rules from config
${config.hard_no.map((r) => `- ${r}`).join("\n")}`;

  if (positives.length > 0 || negatives.length > 0) {
    prompt += "\n\n## Your actual preferences (weight these heavily):\n";
    prompt += formatFeedbackExamples(positives, "Items you liked:");
    if (negatives.length > 0) {
      prompt += "\n" + formatFeedbackExamples(negatives, "Items that were wrong:");
    }
  }

  return prompt;
}

export function buildUserPrompt(listings: PreparedListing[]): string {
  return `Score these ${listings.length} listings. Return a JSON array with one object per listing.

Listings:
${JSON.stringify(listings, null, 2)}

Required fields per listing: listing_id, score, quality, value, aesthetic, size, reason.
Use exact listing_id from input.`;
}
