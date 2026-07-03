import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditResponse } from "@fm/shared/dto.js";
import { useCan, useMe } from "@/hooks/use-auth";
import { AuditPage, buildAuditUrl } from "./audit";

const apiGet = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) };
});

vi.mock("@/hooks/use-auth", () => ({ useCan: vi.fn(), useMe: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

describe("buildAuditUrl", () => {
  it("builds the base url with just limit/offset when no filters are set", () => {
    expect(buildAuditUrl({ category: "", actor: "" }, 0)).toBe("/api/audit?limit=50&offset=0");
  });

  it("includes category when set", () => {
    expect(buildAuditUrl({ category: "users", actor: "" }, 0)).toBe(
      "/api/audit?limit=50&offset=0&category=users",
    );
  });

  it("includes a trimmed actor when set", () => {
    expect(buildAuditUrl({ category: "", actor: "  owner@example.com  " }, 50)).toBe(
      "/api/audit?limit=50&offset=50&actor=owner%40example.com",
    );
  });

  it("omits actor entirely when it's only whitespace", () => {
    expect(buildAuditUrl({ category: "", actor: "   " }, 0)).toBe("/api/audit?limit=50&offset=0");
  });
});

function auditRow(overrides: Partial<AuditResponse["entries"][number]> = {}) {
  return {
    id: 1,
    profile_id: "default",
    user_id: 1,
    actor_email: "owner@example.com",
    action: "user.create",
    target: "curator@example.com",
    detail: null,
    recorded_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function auditResponse(overrides: Partial<AuditResponse> = {}): AuditResponse {
  return {
    entries: [auditRow()],
    total: 1,
    limit: 50,
    offset: 0,
    has_more: false,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

describe("AuditPage", () => {
  beforeEach(() => {
    apiGet.mockReset();
    vi.mocked(useMe).mockReturnValue({ isLoading: false } as ReturnType<typeof useMe>);
    vi.mocked(useCan).mockReturnValue(() => true);
  });

  it("shows an empty state when there are no matching events", async () => {
    apiGet.mockResolvedValue(auditResponse({ entries: [], total: 0 }));
    renderPage();

    expect(await screen.findByText("No matching events")).toBeInTheDocument();
    expect(screen.getByText("No audit events recorded yet.")).toBeInTheDocument();
  });

  it("renders a row with actor link, action label, target link, and detail", async () => {
    apiGet.mockResolvedValue(
      auditResponse({
        entries: [
          auditRow({ action: "user.create", target: "curator@example.com", detail: '{"role":"curator"}' }),
        ],
      }),
    );
    renderPage();

    expect(await screen.findByText("User created")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText("curator@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "curator@example.com" })).toHaveAttribute("href", "/users");
  });

  it("routes a search_group target to the monitors page, not the users page", async () => {
    apiGet.mockResolvedValue(
      auditResponse({
        entries: [auditRow({ action: "search_group.create", target: "corduroy-jacket" })],
      }),
    );
    renderPage();

    const link = await screen.findByRole("link", { name: "corduroy-jacket" });
    expect(link).toHaveAttribute("href", "/monitors");
  });

  it("shows an em dash for a null actor or target", async () => {
    apiGet.mockResolvedValue(
      auditResponse({
        entries: [auditRow({ actor_email: null, target: null })],
      }),
    );
    renderPage();

    await screen.findByText("User created");
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the count summary and disables Previous at offset 0", async () => {
    apiGet.mockResolvedValue(auditResponse({ total: 120, offset: 0, has_more: true }));
    renderPage();

    expect(await screen.findByText("Showing 1–1 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next when has_more is false", async () => {
    apiGet.mockResolvedValue(auditResponse({ has_more: false }));
    renderPage();

    expect(await screen.findByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("clicking Next requests the next page's offset", async () => {
    apiGet.mockResolvedValue(auditResponse({ has_more: true, total: 120 }));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(expect.stringContaining("offset=50")),
    );
  });

  it("changing the actor filter resets the page back to offset 0", async () => {
    apiGet.mockResolvedValue(auditResponse({ has_more: true, total: 120 }));
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(expect.stringContaining("offset=50")));

    apiGet.mockClear();
    await userEvent.type(screen.getByLabelText("Actor email"), "a");

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(expect.stringMatching(/offset=0.*actor=a|actor=a.*offset=0/)),
    );
  });

  it("shows an error message when the query fails", async () => {
    apiGet.mockRejectedValue(new Error("network down"));
    renderPage();

    expect(await screen.findByText(/failed to load audit log/i)).toBeInTheDocument();
  });
});
