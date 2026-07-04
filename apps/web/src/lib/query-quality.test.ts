import { describe, expect, it } from "vitest";
import {
  alertRateLevel,
  feedbackRatioLevel,
  yesRateLevel,
  overallQueryQuality,
} from "./query-quality";

describe("alertRateLevel", () => {
  it("is unknown for null", () => {
    expect(alertRateLevel(null)).toBe("unknown");
  });

  it("thresholds at 5% (good) and 1% (borderline)", () => {
    expect(alertRateLevel(0.05)).toBe("good");
    expect(alertRateLevel(0.06)).toBe("good");
    expect(alertRateLevel(0.01)).toBe("borderline");
    expect(alertRateLevel(0.049)).toBe("borderline");
    expect(alertRateLevel(0.009)).toBe("poor");
    expect(alertRateLevel(0)).toBe("poor");
  });
});

describe("feedbackRatioLevel", () => {
  it("is unknown when there's no feedback at all", () => {
    expect(feedbackRatioLevel(null, 0)).toBe("unknown");
    expect(feedbackRatioLevel(0.5, 0)).toBe("unknown");
  });

  it("is poor when there's feedback but no ratio", () => {
    expect(feedbackRatioLevel(null, 5)).toBe("poor");
  });

  it("thresholds at 60% (good) and 40% (borderline)", () => {
    expect(feedbackRatioLevel(0.6, 5)).toBe("good");
    expect(feedbackRatioLevel(0.4, 5)).toBe("borderline");
    expect(feedbackRatioLevel(0.39, 5)).toBe("poor");
  });
});

describe("yesRateLevel", () => {
  it("is unknown for null", () => {
    expect(yesRateLevel(null)).toBe("unknown");
  });

  it("thresholds at 15% (good) and 5% (borderline)", () => {
    expect(yesRateLevel(0.15)).toBe("good");
    expect(yesRateLevel(0.05)).toBe("borderline");
    expect(yesRateLevel(0.049)).toBe("poor");
  });
});

function row(overrides: Partial<Parameters<typeof overallQueryQuality>[0]> = {}) {
  return {
    alert_rate: null,
    feedback_ratio: null,
    feedback_positive: 0,
    feedback_negative: 0,
    yes_rate: null,
    ...overrides,
  };
}

describe("overallQueryQuality", () => {
  it("is unknown when every underlying signal is unknown", () => {
    expect(overallQueryQuality(row())).toBe("unknown");
  });

  it("is good only when every known signal is good", () => {
    expect(
      overallQueryQuality(
        row({ alert_rate: 0.1, yes_rate: 0.2, feedback_ratio: 0.8, feedback_positive: 4, feedback_negative: 1 }),
      ),
    ).toBe("good");
  });

  it("is poor if any known signal is poor, even if others are good", () => {
    expect(
      overallQueryQuality(
        row({ alert_rate: 0.001, yes_rate: 0.2, feedback_ratio: 0.8, feedback_positive: 4, feedback_negative: 1 }),
      ),
    ).toBe("poor");
  });

  it("is borderline when the worst known signal is borderline (no poor signals present)", () => {
    expect(overallQueryQuality(row({ alert_rate: 0.02, yes_rate: 0.2 }))).toBe("borderline");
  });

  it("ignores signals with no data rather than treating them as poor", () => {
    // Only yes_rate has data (good) - alert_rate and feedback stay unknown and don't drag it down.
    expect(overallQueryQuality(row({ yes_rate: 0.2 }))).toBe("good");
  });
});
