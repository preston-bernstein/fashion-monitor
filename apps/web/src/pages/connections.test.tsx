import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConnectionsResponse, ConnectionDto } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { ConnectionsPage } from "./connections";

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

function mockCan(...extraCaps: string[]) {
  const granted = new Set(["secrets:read", ...extraCaps]);
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

function renderPage(response: ConnectionsResponse) {
  apiGet.mockResolvedValue(response);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectionsPage />
    </QueryClientProvider>,
  );
}

describe("ConnectionsPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    mockCan();
  });

  it("renders active connections without the dormant section heading", async () => {
    renderPage({ connections: [connection({ platform: "ebay", label: "eBay", dormant: false })] });

    expect(await screen.findByText("eBay")).toBeInTheDocument();
    expect(
      screen.queryByText(/login-based connections are disabled pending ToS review/i),
    ).not.toBeInTheDocument();
  });

  it("shows the dormant section only when there are dormant connections", async () => {
    renderPage({
      connections: [
        connection({ platform: "ebay", label: "eBay", dormant: false }),
        connection({ platform: "poshmark", label: "Poshmark", dormant: true }),
      ],
    });

    expect(await screen.findByText("eBay")).toBeInTheDocument();
    expect(screen.getByText("Poshmark")).toBeInTheDocument();
    expect(
      screen.getByText(/login-based connections are disabled pending ToS review/i),
    ).toBeInTheDocument();
  });

  it("passes canWrite through to connection cards based on secrets:write", async () => {
    mockCan("secrets:write");
    renderPage({ connections: [connection({ platform: "ebay" })] });

    expect(await screen.findByText("eBay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test/i })).toBeInTheDocument();
  });

  it("hides write actions on connection cards without secrets:write", async () => {
    renderPage({ connections: [connection({ platform: "ebay" })] });

    await screen.findByText("eBay");
    expect(screen.queryByRole("button", { name: /test/i })).not.toBeInTheDocument();
  });
});
