import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SearchGroup } from "@fm/shared/dto.js";
import { ApiError } from "@/lib/api";
import { MonitorDialog } from "./monitor-dialog";

const apiPost = vi.fn();
const apiPatch = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPost: (...args: unknown[]) => apiPost(...args), apiPatch: (...args: unknown[]) => apiPatch(...args) };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

function renderDialog(props: Partial<React.ComponentProps<typeof MonitorDialog>> = {}) {
  const queryClient = new QueryClient();
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MonitorDialog
        open={true}
        mode="create"
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onSaved };
}

function sampleGroup(overrides: Partial<SearchGroup> = {}): SearchGroup {
  return {
    id: "corduroy-jacket",
    query_text: "corduroy jacket XXL",
    platforms: ["ebay", "grailed"],
    query_overrides: {},
    enabled: true,
    status: "active",
    note: "test note",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as SearchGroup;
}

describe("MonitorDialog", () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPatch.mockReset();
  });

  it("create mode: ID field is editable and defaults platforms from defaultPlatforms", () => {
    renderDialog({ mode: "create", defaultPlatforms: ["grailed"] });
    expect(screen.getByLabelText("ID")).not.toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "grailed" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "ebay" })).not.toBeChecked();
  });

  it("create mode: falls back to ebay when defaultPlatforms has nothing implemented", () => {
    renderDialog({ mode: "create", defaultPlatforms: [] });
    expect(screen.getByRole("checkbox", { name: "ebay" })).toBeChecked();
  });

  it("edit mode: ID field is disabled and prefilled from the group", () => {
    renderDialog({ mode: "edit", group: sampleGroup() });
    const idField = screen.getByLabelText("ID");
    expect(idField).toBeDisabled();
    expect(idField).toHaveValue("corduroy-jacket");
    expect(screen.getByLabelText("Query")).toHaveValue("corduroy jacket XXL");
    expect(screen.getByRole("checkbox", { name: "ebay" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "grailed" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "depop" })).not.toBeChecked();
  });

  it("toggling a platform checkbox adds it to the field value", async () => {
    renderDialog({ mode: "create" });
    const depop = screen.getByRole("checkbox", { name: "depop" });
    expect(depop).not.toBeChecked();
    await userEvent.click(depop);
    expect(depop).toBeChecked();
  });

  it("submitting in create mode calls apiPost with the form body", async () => {
    apiPost.mockResolvedValue({ id: "new-monitor" });
    const { onSaved } = renderDialog({ mode: "create" });

    await userEvent.type(screen.getByLabelText("ID"), "new-monitor");
    await userEvent.type(screen.getByLabelText("Query"), "wool sweater");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const [url, body] = apiPost.mock.calls[0];
    expect(url).toBe("/api/monitors");
    expect(body).toMatchObject({ id: "new-monitor", query_text: "wool sweater", platforms: ["ebay"] });
    expect(onSaved).toHaveBeenCalled();
  });

  it("submitting in edit mode calls apiPatch against the group's id, without an id field in the body", async () => {
    apiPatch.mockResolvedValue({ ok: true });
    const { onSaved } = renderDialog({ mode: "edit", group: sampleGroup() });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1));
    const [url, body] = apiPatch.mock.calls[0];
    expect(url).toBe("/api/monitors/corduroy-jacket");
    expect(body).not.toHaveProperty("id");
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows a duplicate-id error inline on the ID field rather than a toast", async () => {
    apiPost.mockRejectedValue(new ApiError(409, "duplicate", "That ID is already taken"));
    const { onSaved } = renderDialog({ mode: "create" });

    await userEvent.type(screen.getByLabelText("ID"), "corduroy-jacket");
    await userEvent.type(screen.getByLabelText("Query"), "wool sweater");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("That ID is already taken")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("cancel calls onOpenChange(false) without submitting", async () => {
    const { onOpenChange } = renderDialog({ mode: "create" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(apiPost).not.toHaveBeenCalled();
  });
});
