import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditDetailCell } from "./audit-detail";

describe("AuditDetailCell", () => {
  it("renders an em dash when detail is null", () => {
    render(<AuditDetailCell detail={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the raw string when detail isn't valid JSON", () => {
    render(<AuditDetailCell detail="not json at all" />);
    expect(screen.getByText("not json at all")).toBeInTheDocument();
  });

  it("renders the raw JSON string when it parses to an array rather than an object", () => {
    render(<AuditDetailCell detail={JSON.stringify([1, 2, 3])} />);
    expect(screen.getByText("[1,2,3]")).toBeInTheDocument();
  });

  it("renders an em dash when the parsed object is empty", () => {
    render(<AuditDetailCell detail="{}" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows a field count button that expands to reveal key/value pairs", async () => {
    render(<AuditDetailCell detail={JSON.stringify({ key: "ntfy_token", role: "curator" })} />);

    const toggle = screen.getByRole("button", { name: /2 fields/i });
    expect(screen.queryByText("ntfy_token")).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByText("key")).toBeInTheDocument();
    expect(screen.getByText("ntfy_token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide detail/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /hide detail/i }));
    expect(screen.queryByText("ntfy_token")).not.toBeInTheDocument();
  });

  it("JSON-stringifies non-string field values", async () => {
    render(<AuditDetailCell detail={JSON.stringify({ fields: ["a", "b"] })} />);
    await userEvent.click(screen.getByRole("button", { name: /1 field/i }));
    expect(screen.getByText("fields")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.tagName === "DD" && element.textContent === JSON.stringify(["a", "b"], null, 2),
      ),
    ).toBeInTheDocument();
  });
});
