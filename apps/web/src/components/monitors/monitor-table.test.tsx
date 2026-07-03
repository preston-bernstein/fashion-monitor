import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SearchGroup } from "@fm/shared/dto.js";
import { MonitorTable } from "./monitor-table";

const fetchMonitorImages = vi.fn();

vi.mock("@/lib/monitor-images-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/monitor-images-query")>();
  return { ...actual, fetchMonitorImages: (...args: unknown[]) => fetchMonitorImages(...args) };
});

vi.mock("@/components/monitors/monitor-image-manager", () => ({
  MonitorImageManager: ({ groupId }: { groupId: string }) => (
    <div data-testid="image-manager">{groupId}</div>
  ),
}));

function sampleGroup(overrides: Partial<SearchGroup> = {}): SearchGroup {
  return {
    id: "corduroy-jacket",
    query_text: "corduroy jacket XXL",
    platforms: ["ebay", "grailed"],
    enabled: true,
    status: "active",
    note: "test note",
    updated_at: "2026-01-01T00:00:00.000Z",
    executions: [],
    ...overrides,
  };
}

function renderTable(props: Partial<React.ComponentProps<typeof MonitorTable>> = {}) {
  const queryClient = new QueryClient();
  const onEditGroup = vi.fn();
  const onToggleGroup = vi.fn();
  const onDeleteGroup = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MonitorTable
        groups={[sampleGroup()]}
        canWrite={true}
        onEditGroup={onEditGroup}
        onToggleGroup={onToggleGroup}
        onDeleteGroup={onDeleteGroup}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onEditGroup, onToggleGroup, onDeleteGroup };
}

describe("MonitorTable", () => {
  beforeEach(() => {
    fetchMonitorImages.mockReset();
    fetchMonitorImages.mockResolvedValue({ curated: [], fallback: [] });
  });

  it("shows an empty state with no groups", () => {
    renderTable({ groups: [] });
    expect(screen.getByText("No search groups yet.")).toBeInTheDocument();
  });

  it("renders a row per group with id, query, and status", () => {
    renderTable({ groups: [sampleGroup(), sampleGroup({ id: "wool-sweater", query_text: "wool sweater" })] });
    expect(screen.getByText("corduroy-jacket")).toBeInTheDocument();
    expect(screen.getByText("wool-sweater")).toBeInTheDocument();
    expect(screen.getByText("corduroy jacket XXL")).toBeInTheDocument();
    expect(screen.getByText("wool sweater")).toBeInTheDocument();
  });

  it("hides the actions column when canWrite is false", () => {
    renderTable({ canWrite: false });
    expect(document.querySelector('[aria-haspopup="menu"]')).not.toBeInTheDocument();
  });

  it("expanding a row fetches its images and mounts the image manager for a write-capable user", async () => {
    renderTable();
    expect(screen.queryByTestId("image-manager")).not.toBeInTheDocument();

    const expandButtons = screen.getAllByRole("button");
    await userEvent.click(expandButtons[0]);

    expect(await screen.findByTestId("image-manager")).toHaveTextContent("corduroy-jacket");
    expect(fetchMonitorImages).toHaveBeenCalledWith("corduroy-jacket");
  });

  it("does not fetch images until the row is expanded", () => {
    renderTable();
    expect(fetchMonitorImages).not.toHaveBeenCalled();
  });

  it("edit/pause/delete dropdown actions call the corresponding callback with the group", async () => {
    const { onEditGroup, onToggleGroup, onDeleteGroup } = renderTable();

    await userEvent.click(document.querySelector('[aria-haspopup="menu"]') as HTMLElement);
    await userEvent.click(await screen.findByText("Edit"));
    expect(onEditGroup).toHaveBeenCalledWith(expect.objectContaining({ id: "corduroy-jacket" }));

    await userEvent.click(document.querySelector('[aria-haspopup="menu"]') as HTMLElement);
    await userEvent.click(await screen.findByText("Pause"));
    expect(onToggleGroup).toHaveBeenCalledWith(expect.objectContaining({ id: "corduroy-jacket" }));

    await userEvent.click(document.querySelector('[aria-haspopup="menu"]') as HTMLElement);
    await userEvent.click(await screen.findByText("Delete"));
    expect(onDeleteGroup).toHaveBeenCalledWith(expect.objectContaining({ id: "corduroy-jacket" }));
  });

  it("shows 'Activate' instead of 'Pause' for a disabled group", async () => {
    renderTable({ groups: [sampleGroup({ enabled: false })] });
    await userEvent.click(document.querySelector('[aria-haspopup="menu"]') as HTMLElement);
    expect(await screen.findByText("Activate")).toBeInTheDocument();
    expect(screen.queryByText("Pause")).not.toBeInTheDocument();
  });

  it("renders execution sub-rows when a group is expanded", async () => {
    renderTable({
      groups: [
        sampleGroup({
          executions: [
            {
              id: "exec-1",
              platform: "ebay",
              query_text: "corduroy jacket XXL",
              enabled: true,
              status: "active",
              last_error: null,
              last_run_at: null,
            },
          ],
        }),
      ],
    });

    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(await screen.findByText("Same as group query")).toBeInTheDocument();
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
  });
});
