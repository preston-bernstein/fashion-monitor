import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConnectionDto } from "@fm/shared/dto.js";
import { apiPost } from "@/lib/api";
import { ConnectionCard } from "./connection-card";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiPost: vi.fn() };
});

// ConnectionCard's only router dependency is <Link> (the "add credentials on
// Secrets" deep link) — stub it to a plain anchor so this stays an isolated
// component test rather than needing a real router.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

function renderCard(connection: ConnectionDto, canWrite = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectionCard connection={connection} canWrite={canWrite} />
    </QueryClientProvider>,
  );
}

function ebayConnection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    platform: "ebay",
    label: "eBay",
    type: "api-key",
    dormant: false,
    automatic: false,
    configured: true,
    status: "untested",
    lastTestedAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("ConnectionCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows an automatic connection with no Test/Disconnect controls", () => {
    renderCard({
      platform: "grailed",
      label: "Grailed",
      type: "none",
      dormant: false,
      automatic: true,
      configured: true,
      status: "ok",
      lastTestedAt: null,
      lastError: null,
    });
    expect(screen.getByText("Grailed")).toBeInTheDocument();
    expect(screen.getByText("Automatic")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
  });

  it("shows a dormant connection as locked with no controls", () => {
    renderCard({
      platform: "poshmark",
      label: "Poshmark",
      type: "login",
      dormant: true,
      automatic: false,
      configured: false,
      status: "not_connected",
      lastTestedAt: null,
      lastError: null,
    });
    expect(screen.getByText("Coming later")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
  });

  it("shows a link to Secrets when an api-key connection is not configured", () => {
    renderCard(ebayConnection({ configured: false, status: "not_connected" }));
    expect(screen.getByRole("link", { name: "Secrets" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("calls the test endpoint and shows success", async () => {
    vi.mocked(apiPost).mockResolvedValue({
      ok: true,
      status: "ok",
      error: null,
      testedAt: "2026-01-01T00:00:00.000Z",
    });
    renderCard(ebayConnection());

    await userEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/connections/ebay/test");
    });
  });

  it("Test button is disabled when not configured", () => {
    renderCard(ebayConnection({ configured: false, status: "not_connected" }));
    expect(screen.getByRole("button", { name: "Test" })).toBeDisabled();
  });

  it("calls the disconnect endpoint", async () => {
    vi.mocked(apiPost).mockResolvedValue({ ok: true });
    renderCard(ebayConnection({ status: "ok", lastTestedAt: "2026-01-01T00:00:00.000Z" }));

    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith("/api/connections/ebay/disconnect");
    });
  });

  it("hides Test/Disconnect controls when the user cannot write secrets", () => {
    renderCard(ebayConnection(), false);
    expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });
});
