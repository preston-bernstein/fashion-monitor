import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DashboardPayload } from "@fm/shared/dto.js";
import { useCan } from "@/hooks/use-auth";
import {
  IntegrationHealthSection,
  QueryRunHistorySection,
  QueryScorecardSection,
  AlertsAndRevisionsSection,
  PromptDietSection,
} from "./dashboard-sections";

const apiPost = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPost: (...args: unknown[]) => apiPost(...args) };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn() }));

function baseData(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return {
    overview: {
      totalRuns: 0,
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

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("IntegrationHealthSection", () => {
  it("shows empty-state messages with no data", () => {
    renderWithClient(<IntegrationHealthSection data={baseData()} />);
    expect(screen.getByText("No integration events recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("No recent failures.")).toBeInTheDocument();
  });

  it("renders uptime and failure rows", () => {
    renderWithClient(
      <IntegrationHealthSection
        data={baseData({
          integrationUptime: [
            { integration: "scraper:ebay", ok_count: 10, degraded_count: 1, fail_count: 0, uptime_pct: 99.1, last_problem_at: null },
          ],
          integrationFailures: [
            { id: 1, integration: "scraper:ebay", operation: "search", status: "failed", error: "timeout", recorded_at: "2026-01-01T00:00:00.000Z" },
          ],
        })}
      />,
    );
    expect(screen.getAllByText("scraper:ebay").length).toBeGreaterThan(0);
    expect(screen.getByText("99.1%")).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
  });
});

describe("QueryRunHistorySection", () => {
  it("shows the empty state with no runs", () => {
    renderWithClient(<QueryRunHistorySection data={baseData()} />);
    expect(screen.getByText("No query runs yet.")).toBeInTheDocument();
  });

  it("renders a row per run", () => {
    renderWithClient(
      <QueryRunHistorySection
        data={baseData({
          queryRunHistory: [
            { run_started_at: "2026-01-01T00:00:00.000Z", platform: "ebay", query_id: "corduroy", query_text: "corduroy jacket", listings_found: 5, listings_new: 2, alerts_sent: 1, error: null },
          ],
        })}
      />,
    );
    expect(screen.getByText("corduroy")).toBeInTheDocument();
    expect(screen.getByText("corduroy jacket")).toBeInTheDocument();
  });
});

function scorecardGroup(overrides: Partial<DashboardPayload["groupScorecard"][number]> = {}) {
  return {
    group_id: "corduroy-jacket",
    query_text: "corduroy jacket XXL",
    platforms: "ebay, grailed",
    status: "active",
    note: null,
    total_runs: 10,
    listings_found: 40,
    listings_new: 12,
    scored_yes: 5,
    alerts_sent: 3,
    alert_rate: 0.08,
    yes_rate: 0.2,
    feedback_positive: 4,
    feedback_negative: 1,
    feedback_ratio: 0.8,
    last_alert_at: null,
    last_good_signal_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("QueryScorecardSection", () => {
  it("shows the empty state with no scorecard rows", () => {
    renderWithClient(<QueryScorecardSection data={baseData()} />);
    expect(screen.getByText("No query runs yet.")).toBeInTheDocument();
  });

  it("renders a group row with its quality level, but not its executions until expanded", async () => {
    renderWithClient(
      <QueryScorecardSection
        data={baseData({
          groupScorecard: [scorecardGroup()],
          queryScorecard: [
            {
              query_id: "corduroy-ebay",
              group_id: "corduroy-jacket",
              platform: "ebay",
              query_text: "corduroy jacket XXL",
              status: "active",
              note: null,
              total_runs: 10,
              listings_found: 40,
              listings_new: 12,
              scored_yes: 5,
              alerts_sent: 3,
              alert_rate: 0.08,
              yes_rate: 0.2,
              feedback_positive: 4,
              feedback_negative: 1,
              feedback_ratio: 0.8,
              last_alert_at: null,
              last_good_signal_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("corduroy-jacket")).toBeInTheDocument();
    expect(screen.getByText("good")).toBeInTheDocument();
    expect(screen.queryByText("corduroy-ebay")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("corduroy-ebay")).toBeInTheDocument();
  });
});

describe("AlertsAndRevisionsSection", () => {
  beforeEach(() => {
    apiPost.mockReset();
    vi.mocked(useCan).mockReturnValue(() => true);
  });

  it("shows empty-state messages with no alerts or revisions", () => {
    renderWithClient(<AlertsAndRevisionsSection data={baseData()} />);
    expect(screen.getByText("No alerts yet.")).toBeInTheDocument();
    expect(screen.getByText("No revisions yet.")).toBeInTheDocument();
  });

  it("renders an alert row with price, platform, and score", () => {
    renderWithClient(
      <AlertsAndRevisionsSection
        data={baseData({
          alerts: [
            {
              id: 1,
              platform: "ebay",
              listing_id: "abc123",
              title: "Helmut Lang sweater",
              price: 85,
              score: "YES",
              alerted_at: "2026-01-01T00:00:00.000Z",
              url: "https://example.com/listing",
              image_url: null,
              source_query_id: "corduroy",
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("Helmut Lang sweater")).toBeInTheDocument();
    expect(screen.getByText("$85")).toBeInTheDocument();
    expect(screen.getByText("YES")).toBeInTheDocument();
  });

  it("feedback buttons are hidden without feedback:write capability", () => {
    vi.mocked(useCan).mockReturnValue(() => false);
    renderWithClient(
      <AlertsAndRevisionsSection
        data={baseData({
          alerts: [
            { id: 1, platform: "ebay", listing_id: "abc123", title: "x", price: 1, score: null, alerted_at: "2026-01-01T00:00:00.000Z", url: null, image_url: null, source_query_id: null },
          ],
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Good find" })).not.toBeInTheDocument();
  });

  it("clicking 'Good find' posts positive feedback and disables both buttons afterward", async () => {
    apiPost.mockResolvedValue({ ok: true });
    renderWithClient(
      <AlertsAndRevisionsSection
        data={baseData({
          alerts: [
            { id: 1, platform: "ebay", listing_id: "abc123", title: "x", price: 1, score: null, alerted_at: "2026-01-01T00:00:00.000Z", url: null, image_url: null, source_query_id: null },
          ],
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Good find" }));

    expect(apiPost).toHaveBeenCalledWith("/api/feedback", {
      platform: "ebay",
      listing_id: "abc123",
      signal: "positive",
    });
    expect(await screen.findByRole("button", { name: "Good find" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not for me" })).toBeDisabled();
  });
});

describe("PromptDietSection", () => {
  it("shows a placeholder message with no feedback examples", () => {
    renderWithClient(<PromptDietSection data={baseData()} />);
    expect(screen.getByText("No feedback recorded yet.")).toBeInTheDocument();
  });

  it("renders positive and negative examples", () => {
    renderWithClient(
      <PromptDietSection
        data={baseData({
          promptDiet: {
            aesthetic_prompt: "",
            hard_no: [],
            positive_signals: { strong: [], weak: [] },
            positive_examples: [{ listing_id: "1", title: "Good jacket" }],
            negative_examples: [{ listing_id: "2", title: "Bad jacket", source_query_id: "corduroy" }],
          },
        })}
      />,
    );
    expect(screen.getByText("+ Good jacket")).toBeInTheDocument();
    expect(screen.getByText("− Bad jacket")).toBeInTheDocument();
    expect(screen.getByText("Revise query")).toBeInTheDocument();
  });

  it("omits the 'Revise query' link when there's no source_query_id", () => {
    renderWithClient(
      <PromptDietSection
        data={baseData({
          promptDiet: {
            aesthetic_prompt: "",
            hard_no: [],
            positive_signals: { strong: [], weak: [] },
            positive_examples: [],
            negative_examples: [{ listing_id: "2", title: "Bad jacket" }],
          },
        })}
      />,
    );
    expect(screen.queryByText("Revise query")).not.toBeInTheDocument();
  });
});
