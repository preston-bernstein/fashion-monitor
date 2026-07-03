import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ConnectionStatus } from "@fm/shared/dto.js";
import { ConnectionStatusBadge } from "./connection-status-badge";

describe("ConnectionStatusBadge", () => {
  const cases: Array<[ConnectionStatus, string]> = [
    ["ok", "Connected"],
    ["degraded", "Degraded"],
    ["failed", "Failed"],
    ["untested", "Untested"],
    ["not_connected", "Not connected"],
  ];

  it.each(cases)("renders the expected label for status %s", (status, label) => {
    render(<ConnectionStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
