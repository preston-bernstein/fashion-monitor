import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardPayload } from "@fm/shared/dto.js";
import { DashboardView } from "./dashboard-view";

vi.mock("@/components/analytics/dashboard-charts", () => ({
  DashboardCharts: () => <div data-testid="dashboard-charts" />,
}));

vi.mock("@/components/analytics/dashboard-sections", () => ({
  AlertsAndRevisionsSection: () => <div data-testid="alerts-section" />,
  PromptDietSection: () => <div data-testid="prompt-diet-section" />,
}));

function baseData(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    overview: {
      totalRuns: 12,
      totalListingsSeen: 340,
      totalAlerts: 5,
      totalYes: 8,
      totalMaybe: 3,
      totalNo: 20,
      totalPending: 2,
      positiveFeedback: 4,
      negativeFeedback: 1,
      lastRunAt: null,
      lastAlertAt: null,
    },
    runs: [],
    alerts: [],
    scoresByPlatform: [],
    dailyRuns: [],
    platformAlerts: [],
    groupScorecard: [],
    queryScorecard: [],
    queryRunHistory: [],
    integrationUptime: [],
    integrationFailures: [],
    configRevisions: [],
    promptDiet: { aesthetic_prompt: "", hard_no: [], positive_signals: { strong: [], weak: [] }, positive_examples: [], negative_examples: [] },
    generatedAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("DashboardView", () => {
  it("renders the overview stat cards with formatted numbers", () => {
    render(<DashboardView data={baseData()} />);

    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Listings seen")).toBeInTheDocument();
    expect(screen.getByText("340")).toBeInTheDocument();
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("− 1")).toBeInTheDocument();
  });

  it("omits the alerts/pending hints when there's no lastAlertAt/lastRunAt", () => {
    render(<DashboardView data={baseData()} />);
    expect(screen.queryByText(/^Last /)).not.toBeInTheDocument();
  });

  it("shows the last-alert and last-run hints when present", () => {
    render(
      <DashboardView
        data={baseData({
          overview: {
            ...baseData().overview,
            lastAlertAt: "2026-01-01T10:00:00.000Z",
            lastRunAt: "2026-01-01T11:00:00.000Z",
          },
        })}
      />,
    );
    expect(screen.getByText(/^Last 2026-01-01 10:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/^Last run 2026-01-01 11:00:00/)).toBeInTheDocument();
  });

  it("renders the child sections and the generatedAt footer", () => {
    render(<DashboardView data={baseData()} />);

    expect(screen.getByTestId("dashboard-charts")).toBeInTheDocument();
    expect(screen.getByTestId("alerts-section")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-diet-section")).toBeInTheDocument();
    expect(screen.getByText(/Updated 2026-01-01 12:00:00/)).toBeInTheDocument();
  });
});
