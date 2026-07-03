import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RunFunnelDto } from "@fm/shared/dto.js";
import { RunFunnelTable } from "./run-funnel-table";

function runRow(overrides: Partial<RunFunnelDto> = {}): RunFunnelDto {
  return {
    id: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:05:00.000Z",
    durationSeconds: 300,
    scraped: 10,
    new: 6,
    prefiltered: 2,
    scoredYes: 1,
    scoredMaybe: 1,
    scoredNo: 2,
    alerted: 1,
    hadError: false,
    ...overrides,
  };
}

describe("RunFunnelTable", () => {
  it("shows an empty state with no runs", () => {
    render(<RunFunnelTable runs={[]} />);
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });

  it("renders the funnel counts for each run", () => {
    render(<RunFunnelTable runs={[runRow({ scraped: 10, new: 6, prefiltered: 3, scoredNo: 2 })]} />);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("shows an Error badge for a run that failed", () => {
    render(<RunFunnelTable runs={[runRow({ hadError: true })]} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows a Running badge for a run with no finishedAt yet", () => {
    render(<RunFunnelTable runs={[runRow({ finishedAt: null, hadError: false })]} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });
});
