import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditFilters, type AuditFiltersState } from "./audit-filters";

describe("AuditFilters", () => {
  it("renders the current actor value", () => {
    const value: AuditFiltersState = { category: "", actor: "someone@example.com" };
    render(<AuditFilters value={value} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Actor email")).toHaveValue("someone@example.com");
  });

  it("calls onChange with the updated actor, leaving category untouched", async () => {
    const onChange = vi.fn();
    const value: AuditFiltersState = { category: "users", actor: "" };
    render(<AuditFilters value={value} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Actor email"), "a");

    expect(onChange).toHaveBeenCalledWith({ category: "users", actor: "a" });
  });

  it("selecting a category calls onChange with that category", async () => {
    const onChange = vi.fn();
    const value: AuditFiltersState = { category: "", actor: "" };
    render(<AuditFilters value={value} onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Users" }));

    expect(onChange).toHaveBeenCalledWith({ category: "users", actor: "" });
  });

  it("selecting 'All categories' maps back to an empty category string", async () => {
    const onChange = vi.fn();
    const value: AuditFiltersState = { category: "users", actor: "" };
    render(<AuditFilters value={value} onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "All categories" }));

    expect(onChange).toHaveBeenCalledWith({ category: "", actor: "" });
  });
});
