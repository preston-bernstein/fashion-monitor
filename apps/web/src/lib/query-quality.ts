import type { QueryScorecardRow, SearchGroupScorecardRow } from "@fm/shared/dto.js";

type ScorecardLike = Pick<
  QueryScorecardRow,
  "alert_rate" | "feedback_ratio" | "feedback_positive" | "feedback_negative" | "yes_rate"
>;

export type QualityLevel = "good" | "borderline" | "poor" | "unknown";

/** Simple heuristics for curator triage — documented in UI tooltips. */
export function alertRateLevel(rate: number | null): QualityLevel {
  if (rate == null) return "unknown";
  if (rate >= 0.05) return "good";
  if (rate >= 0.01) return "borderline";
  return "poor";
}

export function feedbackRatioLevel(ratio: number | null, total: number): QualityLevel {
  if (total === 0) return "unknown";
  if (ratio == null) return "poor";
  if (ratio >= 0.6) return "good";
  if (ratio >= 0.4) return "borderline";
  return "poor";
}

export function yesRateLevel(rate: number | null): QualityLevel {
  if (rate == null) return "unknown";
  if (rate >= 0.15) return "good";
  if (rate >= 0.05) return "borderline";
  return "poor";
}

export function overallQueryQuality(row: ScorecardLike | SearchGroupScorecardRow): QualityLevel {
  const levels = [
    alertRateLevel(row.alert_rate),
    feedbackRatioLevel(row.feedback_ratio, row.feedback_positive + row.feedback_negative),
    yesRateLevel(row.yes_rate),
  ].filter((l) => l !== "unknown");

  if (levels.length === 0) return "unknown";
  if (levels.some((l) => l === "poor")) return "poor";
  if (levels.some((l) => l === "borderline")) return "borderline";
  return "good";
}

export const QUALITY_TOOLTIP =
  "Green: alert rate ≥5%, feedback ratio ≥60%, YES rate ≥15%. Yellow: mid thresholds. Red: below yellow. Needs run/feedback data.";
