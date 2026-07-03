import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConnectionsResponse, HealthResponse, ConnectionDto } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { toast } from "sonner";
import { HealthPage } from "./health";

const apiGet = vi.fn();
const apiPost = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiGet: (...args: unknown[]) => apiGet(...args),
    apiPost: (...args: unknown[]) => apiPost(...args),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

// RequireCapability itself checks "analytics:read"; always grant it here so
// the page renders, and layer in whichever extra caps a given test needs.
function mockCan(...extraCaps: string[]) {
  const granted = new Set(["analytics:read", ...extraCaps]);
  vi.mocked(useCan).mockReturnValue((cap: string) => granted.has(cap));
}

function connection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    platform: "ebay",
    label: "eBay",
    type: "api-key",
    dormant: false,
    automatic: false,
    configured: true,
    status: "ok",
    lastTestedAt: null,
    lastError: null,
    ...overrides,
  };
}

function healthResponse(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return { runs: [], lastAlertedAt: null, ...overrides };
}

function connectionsResponse(overrides: Partial<ConnectionsResponse> = {}): ConnectionsResponse {
  return { connections: [connection()], ...overrides };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <HealthPage />
    </QueryClientProvider>,
  );
}

describe("HealthPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
  });

  it("shows 'No alerts sent yet.' when there's no lastAlertedAt", async () => {
    mockCan();
    apiGet.mockImplementation((url: string) =>
      url === "/api/profile-health" ? Promise.resolve(healthResponse()) : Promise.resolve(connectionsResponse()),
    );
    renderPage();

    expect(await screen.findByText("No alerts sent yet.")).toBeInTheDocument();
  });

  it("shows the last-alerted timestamp when present", async () => {
    mockCan();
    apiGet.mockResolvedValue(healthResponse({ lastAlertedAt: "2026-01-01T12:00:00.000Z" }));
    renderPage();

    expect(await screen.findByText(/you were last alerted/i)).toBeInTheDocument();
  });

  it("hides the Connections card entirely without secrets:read", async () => {
    mockCan();
    apiGet.mockResolvedValue(healthResponse());
    renderPage();

    await screen.findByText("Health");
    expect(screen.queryByText("Connections")).not.toBeInTheDocument();
  });

  it("shows non-dormant connections and hides dormant ones, given secrets:read", async () => {
    mockCan("secrets:read");
    apiGet.mockImplementation((url: string) =>
      url === "/api/profile-health"
        ? Promise.resolve(healthResponse())
        : Promise.resolve(
            connectionsResponse({
              connections: [
                connection({ platform: "ebay", label: "eBay", dormant: false }),
                connection({ platform: "poshmark", label: "Poshmark", dormant: true }),
              ],
            }),
          ),
    );
    renderPage();

    expect(await screen.findByText("eBay")).toBeInTheDocument();
    expect(screen.queryByText("Poshmark")).not.toBeInTheDocument();
  });

  it("hides the 'Test all connections' button without secrets:write", async () => {
    mockCan("secrets:read");
    apiGet.mockImplementation((url: string) =>
      url === "/api/profile-health" ? Promise.resolve(healthResponse()) : Promise.resolve(connectionsResponse()),
    );
    renderPage();

    await screen.findByText("Connections");
    expect(screen.queryByRole("button", { name: "Test all connections" })).not.toBeInTheDocument();
  });

  it("'Test all connections' only tests non-dormant, non-automatic connections", async () => {
    mockCan("secrets:read", "secrets:write");
    apiGet.mockImplementation((url: string) =>
      url === "/api/profile-health"
        ? Promise.resolve(healthResponse())
        : Promise.resolve(
            connectionsResponse({
              connections: [
                connection({ platform: "ebay", dormant: false, automatic: false }),
                connection({ platform: "grailed", dormant: false, automatic: true }),
                connection({ platform: "poshmark", dormant: true, automatic: false }),
              ],
            }),
          ),
    );
    apiPost.mockResolvedValue({ ok: true });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Test all connections" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith("/api/connections/ebay/test");
  });

  it("shows an info toast when there's nothing to test", async () => {
    mockCan("secrets:read", "secrets:write");
    apiGet.mockImplementation((url: string) =>
      url === "/api/profile-health"
        ? Promise.resolve(healthResponse())
        : Promise.resolve(connectionsResponse({ connections: [] })),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Test all connections" }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Nothing to test yet."));
    expect(apiPost).not.toHaveBeenCalled();
  });

  it("shows an error toast naming the failure count when some tests fail", async () => {
    mockCan("secrets:read", "secrets:write");
    apiGet.mockImplementation((url: string) =>
      url === "/api/profile-health"
        ? Promise.resolve(healthResponse())
        : Promise.resolve(
            connectionsResponse({
              connections: [
                connection({ platform: "ebay", dormant: false, automatic: false }),
                connection({ platform: "vestiaire", dormant: false, automatic: false }),
              ],
            }),
          ),
    );
    apiPost.mockImplementation((url: string) =>
      url.includes("ebay") ? Promise.resolve({ ok: true }) : Promise.reject(new Error("failed")),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Test all connections" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("1 of 2 connection tests failed."));
  });
});
