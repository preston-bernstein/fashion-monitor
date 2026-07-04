import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DashboardPayload } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { AnalyticsPage } from "./analytics";

const apiGet = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) };
});

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@/components/analytics/dashboard-view", () => ({
  DashboardView: ({ data }: { data: DashboardPayload }) => (
    <div data-testid="dashboard-view">runs: {data.overview.totalRuns}</div>
  ),
}));

vi.mock("@/components/analytics/onboarding-checklist", () => ({
  OnboardingChecklist: () => <div data-testid="onboarding-checklist" />,
}));

function baseData(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    overview: {
      totalRuns: 3,
      totalListingsSeen: 0,
      totalAlerts: 0,
      totalYes: 0,
      totalMaybe: 0,
      totalNo: 0,
      totalPending: 0,
      positiveFeedback: 0,
      negativeFeedback: 0,
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
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsPage />
    </QueryClientProvider>,
  );
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => true);
  });

  it("shows an error message when the dashboard query fails", async () => {
    apiGet.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText(/failed to load dashboard/i)).toBeInTheDocument();
  });

  it("renders the onboarding checklist and dashboard view once data loads", async () => {
    apiGet.mockResolvedValue(baseData());
    renderPage();

    expect(await screen.findByTestId("onboarding-checklist")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-view")).toHaveTextContent("runs: 3");
  });
});
