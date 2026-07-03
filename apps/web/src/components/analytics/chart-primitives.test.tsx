import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard, ChartCard, EmptyChart, SimpleTable } from "./chart-primitives";

describe("StatCard", () => {
  it("renders the label and value", () => {
    render(<StatCard label="Alerts sent" value="42" />);
    expect(screen.getByText("Alerts sent")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders the hint only when provided", () => {
    const { rerender } = render(<StatCard label="Alerts sent" value="42" hint="last 7 days" />);
    expect(screen.getByText("last 7 days")).toBeInTheDocument();

    rerender(<StatCard label="Alerts sent" value="42" />);
    expect(screen.queryByText("last 7 days")).not.toBeInTheDocument();
  });
});

describe("ChartCard", () => {
  it("renders the title, optional description, and children", () => {
    render(
      <ChartCard title="Scored listings" description="By verdict">
        <div>chart body</div>
      </ChartCard>,
    );
    expect(screen.getByText("Scored listings")).toBeInTheDocument();
    expect(screen.getByText("By verdict")).toBeInTheDocument();
    expect(screen.getByText("chart body")).toBeInTheDocument();
  });

  it("omits the description when none is given", () => {
    render(
      <ChartCard title="Scored listings">
        <div>chart body</div>
      </ChartCard>,
    );
    expect(screen.getByText("Scored listings")).toBeInTheDocument();
  });
});

describe("EmptyChart", () => {
  it("renders the no-data message", () => {
    render(<EmptyChart />);
    expect(screen.getByText("No data yet.")).toBeInTheDocument();
  });
});

describe("SimpleTable", () => {
  it("renders the empty message when there are no rows", () => {
    render(<SimpleTable head={["Platform", "Count"]} rows={[]} empty="No data yet." />);
    expect(screen.getByText("No data yet.")).toBeInTheDocument();
  });

  it("renders headers and row cells when rows are present", () => {
    render(
      <SimpleTable
        head={["Platform", "Count"]}
        rows={[
          ["ebay", "5"],
          ["grailed", "3"],
        ]}
        empty="No data yet."
      />,
    );
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();
    expect(screen.getByText("ebay")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("grailed")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
