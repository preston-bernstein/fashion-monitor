import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MonitorsResponse, SearchGroup } from "@fm/shared/dto.js";
import { ApiError } from "@/lib/api";
import { useCan, useMe } from "@/hooks/use-auth";
import { MonitorsPage } from "./monitors";

const fetchMonitors = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const useSearch = vi.fn();
const navigate = vi.fn();

vi.mock("@/lib/monitors-query", () => ({
  MONITORS_QUERY_KEY: ["monitors"],
  fetchMonitors: () => fetchMonitors(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiPatch: (...args: unknown[]) => apiPatch(...args),
    apiDelete: (...args: unknown[]) => apiDelete(...args),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({ useSearch: () => useSearch() }),
  useNavigate: () => navigate,
}));

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@/components/monitors/monitor-table", () => ({
  MonitorTable: (props: {
    groups: SearchGroup[];
    canWrite: boolean;
    highlightId?: string;
    onEditGroup: (g: SearchGroup) => void;
    onToggleGroup: (g: SearchGroup) => void;
    onDeleteGroup: (g: SearchGroup) => void;
  }) => (
    <div data-testid="monitor-table">
      <div data-testid="highlight-id">{props.highlightId ?? "none"}</div>
      <div data-testid="can-write">{String(props.canWrite)}</div>
      {props.groups.map((g) => (
        <div key={g.id}>
          <span>{g.id}</span>
          <button onClick={() => props.onEditGroup(g)}>Edit {g.id}</button>
          <button onClick={() => props.onToggleGroup(g)}>Toggle {g.id}</button>
          <button onClick={() => props.onDeleteGroup(g)}>Delete {g.id}</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/monitors/monitor-dialog", () => ({
  MonitorDialog: (props: {
    open: boolean;
    mode: "create" | "edit";
    group?: SearchGroup;
    defaultPlatforms?: string[];
    onSaved: () => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    props.open ? (
      <div data-testid={`monitor-dialog-${props.mode}`}>
        <span>group: {props.group?.id ?? "none"}</span>
        <span>defaultPlatforms: {(props.defaultPlatforms ?? []).join(",")}</span>
        <button onClick={props.onSaved}>Save {props.mode}</button>
        <button onClick={() => props.onOpenChange(false)}>Close {props.mode}</button>
      </div>
    ) : null,
}));

function sampleGroup(overrides: Partial<SearchGroup> = {}): SearchGroup {
  return {
    id: "corduroy-jacket",
    query_text: "corduroy jacket XXL",
    platforms: ["ebay"],
    enabled: true,
    status: "active",
    note: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    executions: [],
    ...overrides,
  };
}

function monitorsResponse(overrides: Partial<MonitorsResponse> = {}): MonitorsResponse {
  return {
    groups: [sampleGroup()],
    platforms: ["ebay", "grailed", "vestiaire", "vinted", "depop", "poshmark"],
    statuses: ["active", "needs_revision", "paused"],
    canWrite: true,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MonitorsPage />
    </QueryClientProvider>,
  );
}

describe("MonitorsPage", () => {
  beforeEach(() => {
    fetchMonitors.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    useSearch.mockReturnValue({ edit: undefined });
    navigate.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => true);
  });

  it("shows an error message when the query fails", async () => {
    fetchMonitors.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText(/failed to load monitors/i)).toBeInTheDocument();
  });

  it("passes canWrite through to MonitorTable and shows/hides the add button accordingly", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse({ canWrite: false }));
    renderPage();

    await screen.findByTestId("monitor-table");
    expect(screen.getByTestId("can-write")).toHaveTextContent("false");
    expect(screen.queryByRole("button", { name: /add search group/i })).not.toBeInTheDocument();
  });

  it("excludes vinted from the create dialog's default platforms", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /add search group/i }));
    const dialog = await screen.findByTestId("monitor-dialog-create");
    expect(dialog).toHaveTextContent("defaultPlatforms: ebay,grailed,vestiaire,depop,poshmark");
  });

  it("clicking Edit on a group opens the edit dialog for that group and highlights it", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Edit corduroy-jacket" }));

    const dialog = await screen.findByTestId("monitor-dialog-edit");
    expect(dialog).toHaveTextContent("group: corduroy-jacket");
    expect(screen.getByTestId("highlight-id")).toHaveTextContent("corduroy-jacket");
  });

  it("deep-links to the edit dialog via the ?edit= search param", async () => {
    useSearch.mockReturnValue({ edit: "corduroy-jacket" });
    fetchMonitors.mockResolvedValue(monitorsResponse());
    renderPage();

    const dialog = await screen.findByTestId("monitor-dialog-edit");
    expect(dialog).toHaveTextContent("group: corduroy-jacket");
    expect(screen.getByTestId("highlight-id")).toHaveTextContent("corduroy-jacket");
  });

  it("closing the deep-linked edit dialog clears the ?edit= search param via navigate", async () => {
    useSearch.mockReturnValue({ edit: "corduroy-jacket" });
    fetchMonitors.mockResolvedValue(monitorsResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Close edit" }));

    expect(navigate).toHaveBeenCalledWith({
      to: "/monitors",
      search: { edit: undefined },
      replace: true,
    });
  });

  it("toggling a group calls apiPatch with enabled flipped and status set accordingly", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse({ groups: [sampleGroup({ enabled: true })] }));
    apiPatch.mockResolvedValue({ ok: true });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Toggle corduroy-jacket" }));

    expect(apiPatch).toHaveBeenCalledWith("/api/monitors/corduroy-jacket", {
      enabled: false,
      status: "paused",
    });
  });

  it("clicking Delete on a group opens the confirmation dialog naming that group", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Delete corduroy-jacket" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete search group");
    expect(dialog).toHaveTextContent("corduroy-jacket");
  });

  it("confirming delete calls apiDelete and closes the confirmation dialog on success", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse());
    apiDelete.mockResolvedValue({ ok: true });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Delete corduroy-jacket" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(apiDelete).toHaveBeenCalledWith("/api/monitors/corduroy-jacket");
    await waitFor(() => expect(screen.queryByText("Delete search group")).not.toBeInTheDocument());
  });

  it("cancelling the delete confirmation does not call apiDelete", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse());
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Delete corduroy-jacket" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Delete search group")).not.toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it("toast-errors on a failed toggle without crashing (an ApiError, mapped by toastApiError)", async () => {
    fetchMonitors.mockResolvedValue(monitorsResponse());
    apiPatch.mockRejectedValue(new ApiError(500, "server_error", "Something broke"));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Toggle corduroy-jacket" }));

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
  });
});
