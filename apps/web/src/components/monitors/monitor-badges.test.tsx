import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  statusVariant,
  MonitorStatusBadge,
  PlatformBadges,
} from "./monitor-badges";

describe("statusVariant", () => {
  it("maps active to success, needs_revision to warning, everything else to secondary", () => {
    expect(statusVariant("active")).toBe("success");
    expect(statusVariant("needs_revision")).toBe("warning");
    expect(statusVariant("paused")).toBe("secondary");
    expect(statusVariant("anything_unrecognized")).toBe("secondary");
  });
});

describe("MonitorStatusBadge", () => {
  it("shows the status text and no 'disabled' label when enabled", () => {
    render(<MonitorStatusBadge status="active" enabled={true} />);
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.queryByText("disabled")).not.toBeInTheDocument();
  });

  it("shows a 'disabled' label when not enabled", () => {
    render(<MonitorStatusBadge status="active" enabled={false} />);
    expect(screen.getByText("disabled")).toBeInTheDocument();
  });
});

describe("PlatformBadges", () => {
  it("renders one badge per platform", () => {
    render(<PlatformBadges platforms={["ebay", "grailed", "depop"]} />);
    expect(screen.getByText("ebay")).toBeInTheDocument();
    expect(screen.getByText("grailed")).toBeInTheDocument();
    expect(screen.getByText("depop")).toBeInTheDocument();
  });

  it("renders nothing for an empty platform list", () => {
    const { container } = render(<PlatformBadges platforms={[]} />);
    expect(container.querySelectorAll("span, div").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toBe("");
  });
});
