import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Me } from "@fm/shared/dto.js";
import { ApiError } from "@/lib/api";
import { useMe, useCan, ME_QUERY_KEY } from "./use-auth";

const apiGet = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) };
});

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function meResponse(overrides: Partial<Me> = {}): Me {
  return {
    user: { id: 1, email: "owner@example.com", role: "owner" },
    capabilities: ["monitors:read", "taste:read"],
    ...overrides,
  };
}

describe("ME_QUERY_KEY", () => {
  it("is a stable, predictable key", () => {
    expect(ME_QUERY_KEY).toEqual(["me"]);
  });
});

describe("useMe", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it("fetches /api/me and returns the resolved user", async () => {
    apiGet.mockResolvedValue(meResponse());
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useMe(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.user.email).toBe("owner@example.com");
    expect(apiGet).toHaveBeenCalledWith("/api/me");
  });

  it("does not retry on a 401 (an unauthenticated visitor shouldn't hammer the endpoint)", async () => {
    apiGet.mockRejectedValue(new ApiError(401, "unauthorized", "Not signed in"));
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useMe(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(apiGet).toHaveBeenCalledTimes(1);
  });
});

describe("useCan", () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it("returns a predicate reflecting the resolved capability set", async () => {
    apiGet.mockResolvedValue(meResponse({ capabilities: ["monitors:read"] }));
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useCan(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current("monitors:read")).toBe(true));
    expect(result.current("users:manage")).toBe(false);
  });

  it("returns false for every capability before /api/me has resolved", () => {
    apiGet.mockReturnValue(new Promise(() => {})); // never resolves
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useCan(), { wrapper: wrapper(queryClient) });

    expect(result.current("monitors:read")).toBe(false);
  });
});
