import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, apiPost } from "@/lib/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the CSRF token on mutating requests and sends credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { csrfToken: "tok-123" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiPost<{ ok: boolean }>("/api/logout");
    expect(result).toEqual({ ok: true });

    // First call fetches the token, second is the mutation carrying the header.
    const [, mutationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = mutationInit.headers as Record<string, string>;
    expect(headers["x-csrf-token"]).toBe("tok-123");
    expect(mutationInit.credentials).toBe("include");
  });

  it("does not request a CSRF token for GET requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { value: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/me");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/me");
  });

  it("throws a typed ApiError on non-2xx responses", async () => {
    // Fresh Response per call (a Response body can only be read once).
    const fetchMock = vi.fn(async () => jsonResponse(401, { error: "unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "unauthorized",
    });
    await expect(api("/api/me")).rejects.toBeInstanceOf(ApiError);
  });
});
