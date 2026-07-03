import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { IntegrationUptime, IntegrationFailure } from "@fm/shared/dto.js";
import { IntegrationUptimeTable, IntegrationFailuresTable } from "./integration-health-table";

function uptimeRow(overrides: Partial<IntegrationUptime> = {}): IntegrationUptime {
  return {
    integration: "scraper:ebay",
    ok_count: 10,
    degraded_count: 1,
    fail_count: 0,
    uptime_pct: 99.5,
    last_problem_at: null,
    ...overrides,
  };
}

function failureRow(overrides: Partial<IntegrationFailure> = {}): IntegrationFailure {
  return {
    id: 1,
    integration: "scraper:ebay",
    operation: "search",
    status: "failed",
    error: "timeout",
    recorded_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("IntegrationUptimeTable", () => {
  it("shows an empty state with no rows", () => {
    render(<IntegrationUptimeTable uptime={[]} />);
    expect(screen.getByText(/no integration events recorded yet/i)).toBeInTheDocument();
  });

  it("renders integration name, uptime percent, and ok/degraded/fail counts", () => {
    render(<IntegrationUptimeTable uptime={[uptimeRow()]} />);
    expect(screen.getByText("scraper:ebay")).toBeInTheDocument();
    expect(screen.getByText("99.5%")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("renders an em dash when uptime_pct is null", () => {
    render(<IntegrationUptimeTable uptime={[uptimeRow({ uptime_pct: null })]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("IntegrationFailuresTable", () => {
  it("shows an empty state with no failures", () => {
    render(<IntegrationFailuresTable failures={[]} />);
    expect(screen.getByText(/no recent failures/i)).toBeInTheDocument();
  });

  it("renders the integration name and status badge for each failure", () => {
    render(<IntegrationFailuresTable failures={[failureRow()]} />);
    expect(screen.getByText("scraper:ebay")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
