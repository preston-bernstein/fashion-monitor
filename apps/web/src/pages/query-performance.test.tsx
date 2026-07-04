import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DashboardPayload } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { QueryPerformancePage } from "./query-performance";

const apiGet = vi.fn();
const useSearch = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) };
});

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => useSearch() }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

function baseData(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    overview: {
      totalRuns: 0, totalListingsSeen: 0, totalAlerts: 0, totalYes: 0, totalMaybe: 0,
      totalNo: 0, totalPending: 0, positiveFeedback: 0, negativeFeedback: 0,
      lastRunAt: null, lastAlertAt: null,
    },
    runs: [],
    alerts: [],
    scoresByPlatform: [],
    dailyRuns: [],
    platformAlerts: [],
    groupScorecard: [
      {
        group_id: "corduroy-jacket", query_text: "corduroy jacket", platforms: "ebay",
        status: "active", note: null, total_runs: 1, listings_found: 1, listings_new: 1,
        scored_yes: 1, alerts_sent: 1, alert_rate: 0.1, yes_rate: 0.2,
        feedback_positive: 0, feedback_negative: 0, feedback_ratio: null,
        last_alert_at: null, last_good_signal_at: null,
      },
      {
        group_id: "wool-sweater", query_text: "wool sweater", platforms: "grailed",
        status: "active", note: null, total_runs: 1, listings_found: 1, listings_new: 1,
        scored_yes: 1, alerts_sent: 1, alert_rate: 0.1, yes_rate: 0.2,
        feedback_positive: 0, feedback_negative: 0, feedback_ratio: null,
        last_alert_at: null, last_good_signal_at: null,
      },
    ],
    queryScorecard: [
      {
        query_id: "corduroy-jacket@ebay", group_id: "corduroy-jacket", platform: "ebay",
        query_text: "corduroy jacket", status: "active", note: null, total_runs: 1,
        listings_found: 1, listings_new: 1, scored_yes: 1, alerts_sent: 1,
        alert_rate: 0.1, yes_rate: 0.2, feedback_positive: 0, feedback_negative: 0,
        feedback_ratio: null, last_alert_at: null, last_good_signal_at: null,
      },
      {
        query_id: "wool-sweater@grailed", group_id: "wool-sweater", platform: "grailed",
        query_text: "wool sweater", status: "active", note: null, total_runs: 1,
        listings_found: 1, listings_new: 1, scored_yes: 1, alerts_sent: 1,
        alert_rate: 0.1, yes_rate: 0.2, feedback_positive: 0, feedback_negative: 0,
        feedback_ratio: null, last_alert_at: null, last_good_signal_at: null,
      },
    ],
    queryRunHistory: [
      {
        run_started_at: "2026-01-01T00:00:00.000Z", platform: "ebay",
        query_id: "corduroy-jacket@ebay", query_text: "corduroy jacket",
        listings_found: 1, listings_new: 1, alerts_sent: 1, error: null,
      },
      {
        run_started_at: "2026-01-01T00:00:00.000Z", platform: "grailed",
        query_id: "wool-sweater@grailed", query_text: "wool sweater",
        listings_found: 1, listings_new: 1, alerts_sent: 1, error: null,
      },
    ],
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
      <QueryPerformancePage />
    </QueryClientProvider>,
  );
}

describe("QueryPerformancePage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => true);
  });

  it("shows an error message when the query fails", async () => {
    useSearch.mockReturnValue({ query: undefined });
    apiGet.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText(/failed to load query performance/i)).toBeInTheDocument();
  });

  it("shows every group when there's no ?query= filter", async () => {
    useSearch.mockReturnValue({ query: undefined });
    apiGet.mockResolvedValue(baseData());
    renderPage();

    expect(await screen.findByText("corduroy-jacket")).toBeInTheDocument();
    expect(screen.getByText("wool-sweater")).toBeInTheDocument();
    expect(screen.queryByText(/filtered to query/i)).not.toBeInTheDocument();
  });

  it("filters the scorecard and run history down to just the focused query", async () => {
    useSearch.mockReturnValue({ query: "corduroy-jacket" });
    apiGet.mockResolvedValue(baseData());
    renderPage();

    expect(await screen.findByText(/filtered to query/i)).toBeInTheDocument();
    // "corduroy-jacket" legitimately appears twice once filtered: once in
    // the "Filtered to query <code>...</code>" banner itself, once as the
    // scorecard row's link.
    expect(screen.getByRole("link", { name: "corduroy-jacket" })).toBeInTheDocument();
    expect(screen.queryByText("wool-sweater")).not.toBeInTheDocument();
  });

  it("matches run-history rows whose query_id is namespaced as focusId@platform", async () => {
    useSearch.mockReturnValue({ query: "corduroy-jacket" });
    apiGet.mockResolvedValue(baseData());
    renderPage();

    await screen.findByText(/filtered to query/i);
    // "corduroy jacket" (the query text) legitimately appears twice once
    // filtered: once in the scorecard row, once in the run-history row -
    // the latter only shows up because focusId@platform matching worked.
    expect(screen.getAllByText("corduroy jacket").length).toBe(2);
  });
});
