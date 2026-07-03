import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SearchGroupImagesResponse } from "@fm/shared/dto.js";
import { apiPost, apiDelete } from "@/lib/api";
import { MonitorImageManager } from "./monitor-image-manager";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPost: vi.fn(), apiDelete: vi.fn() };
});

function renderManager(gallery: SearchGroupImagesResponse) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MonitorImageManager groupId="jacket-watch" gallery={gallery} />
    </QueryClientProvider>,
  );
}

describe("MonitorImageManager", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("always shows the add-by-URL form", () => {
    renderManager({ group_id: "jacket-watch", curated: [], fallback: [] });
    expect(screen.getByPlaceholderText("Paste an image URL")).toBeInTheDocument();
  });

  it("shows recent auto-picked candidates not already curated, and lets you pick one", async () => {
    vi.mocked(apiPost).mockResolvedValue({});
    renderManager({
      group_id: "jacket-watch",
      curated: [],
      fallback: [
        { platform: "ebay", listing_id: "yes-1", url: "https://i.ebayimg.com/yes.jpg", score: "YES" },
      ],
    });

    expect(screen.getByText(/pick from recent good matches/i)).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("Add to gallery"));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/monitors/jacket-watch/images", {
        source: "listing",
        platform: "ebay",
        listing_id: "yes-1",
      });
    });
  });

  it("hides a candidate already curated from the pick list", () => {
    renderManager({
      group_id: "jacket-watch",
      curated: [
        {
          id: 1,
          source: "listing",
          listing_platform: "ebay",
          listing_id: "yes-1",
          url: "https://i.ebayimg.com/yes.jpg",
          sort_order: 0,
          caption: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      fallback: [
        { platform: "ebay", listing_id: "yes-1", url: "https://i.ebayimg.com/yes.jpg", score: "YES" },
      ],
    });

    expect(screen.queryByText(/pick from recent good matches/i)).not.toBeInTheDocument();
  });

  it("removes a curated image", async () => {
    vi.mocked(apiDelete).mockResolvedValue({});
    renderManager({
      group_id: "jacket-watch",
      curated: [
        {
          id: 7,
          source: "listing",
          listing_platform: "ebay",
          listing_id: "yes-1",
          url: "https://i.ebayimg.com/yes.jpg",
          sort_order: 0,
          caption: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      fallback: [],
    });

    await userEvent.click(screen.getByRole("button", { name: "Remove image" }));

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith("/api/monitors/jacket-watch/images/7");
    });
  });

  it("adds an image by URL", async () => {
    vi.mocked(apiPost).mockResolvedValue({});
    renderManager({ group_id: "jacket-watch", curated: [], fallback: [] });

    await userEvent.type(
      screen.getByPlaceholderText("Paste an image URL"),
      "https://i.ebayimg.com/manual.jpg",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/monitors/jacket-watch/images", {
        source: "url",
        url: "https://i.ebayimg.com/manual.jpg",
      });
    });
  });
});
