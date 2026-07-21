import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as client from "../../../src/platforms/stealth-sidecar/client.js";
import { SidecarResponseError, SidecarUnreachableError } from "../../../src/platforms/stealth-sidecar/errors.js";

/**
 * Mirrors the client's own internal constants (client.ts is not expected to
 * export them) so tests can assert against the real values rather than
 * inventing their own. Keep these in sync with client.ts if they ever change.
 */
const DEFAULT_OP_TIMEOUT_MS = 30_000;
const MAX_NAVIGATE_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 200;

const BASE_URL = "http://sidecar-test:8000";
const ORIGINAL_SIDECAR_URL = process.env.STEALTH_SIDECAR_URL;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

/** A fetch mock whose pending call only settles when its AbortSignal fires. */
function abortAwareFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  });
}

describe("stealth-sidecar client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.STEALTH_SIDECAR_URL = BASE_URL;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (ORIGINAL_SIDECAR_URL === undefined) {
      delete process.env.STEALTH_SIDECAR_URL;
    } else {
      process.env.STEALTH_SIDECAR_URL = ORIGINAL_SIDECAR_URL;
    }
  });

  describe("getSidecarBaseUrl", () => {
    it("reads STEALTH_SIDECAR_URL from the environment", () => {
      expect(client.getSidecarBaseUrl()).toBe(BASE_URL);
    });

    it("falls back to the local default when unset", () => {
      delete process.env.STEALTH_SIDECAR_URL;
      expect(client.getSidecarBaseUrl()).toBe("http://127.0.0.1:8000");
    });
  });

  describe("successful calls", () => {
    it("createContext posts a flat body (not wrapped in `options`) and returns contextId", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { context_id: "ctx-1" }));

      const result = await client.createContext({ userDataDir: "/tmp/profile" });

      expect(result).toEqual({ contextId: "ctx-1" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/contexts`);
      expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
      expect(JSON.parse(init.body)).toEqual({ user_data_dir: "/tmp/profile" });
    });

    it("createContext omits user_data_dir entirely when no options are given", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { context_id: "ctx-2" }));

      await client.createContext();

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({});
    });

    it("createPage posts to /v1/contexts/{contextId}/pages and returns pageId", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { page_id: "page-1" }));

      const result = await client.createPage("ctx-1");

      expect(result).toEqual({ pageId: "page-1" });
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/v1/contexts/ctx-1/pages`,
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("navigate posts { url, timeout_ms } to /v1/pages/{pageId}/navigate", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await client.navigate("page-1", "https://example.com/item", 5000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${BASE_URL}/v1/pages/page-1/navigate`);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ url: "https://example.com/item", timeout_ms: 5000 });
    });

    it("navigate omits timeout_ms from the body when no timeout is passed", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await client.navigate("page-1", "https://example.com/item");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body)).toEqual({ url: "https://example.com/item" });
    });

    it("getContent GETs /v1/pages/{pageId}/content and returns the raw HTML string", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { content: "<html>ok</html>" }));

      const content = await client.getContent("page-1");

      expect(content).toBe("<html>ok</html>");
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/v1/pages/page-1/content`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("getScreenshot GETs /v1/pages/{pageId}/screenshot and decodes base64 into a Buffer", async () => {
      const base64Png = Buffer.from("fake-png-bytes").toString("base64");
      fetchMock.mockResolvedValue(jsonResponse(200, { screenshot: base64Png }));

      const buf = await client.getScreenshot("page-1");

      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.toString("utf8")).toBe("fake-png-bytes");
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/v1/pages/page-1/screenshot`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("checkHealth resolves normally when status is healthy", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: "healthy" }));

      await expect(client.checkHealth()).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/v1/health`,
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("closePage DELETEs /v1/pages/{pageId}", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await expect(client.closePage("page-1")).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/v1/pages/page-1`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("closeContext DELETEs /v1/contexts/{contextId}", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await expect(client.closeContext("ctx-1")).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/v1/contexts/ctx-1`,
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("closePage treats a 404 as success (already gone), not an error", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(404, { error: { type: "not_found", message: "page not found" } }),
      );

      await expect(client.closePage("gone-page")).resolves.toBeUndefined();
    });
  });

  describe("navigate's timeout-capping behavior", () => {
    it("caps a caller-requested timeout above the sidecar's limit at MAX_NAVIGATE_TIMEOUT_MS (25000)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await client.navigate("page-1", "https://example.com/item", 60_000);

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.timeout_ms).toBe(MAX_NAVIGATE_TIMEOUT_MS);
      expect(body.timeout_ms).not.toBe(60_000);
    });

    it("passes a caller timeout through unchanged when it's already under the cap", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      await client.navigate("page-1", "https://example.com/item", 10_000);

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).timeout_ms).toBe(10_000);
    });
  });

  describe("connect-error retry behavior", () => {
    it("retries exactly once after a connect-level rejection, and returns normally when the retry succeeds", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"))
        .mockResolvedValueOnce(jsonResponse(200, { status: "healthy" }));

      const resultPromise = client.checkHealth();
      await vi.runAllTimersAsync();
      await expect(resultPromise).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("waits the fixed retry delay before firing the second attempt", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"))
        .mockResolvedValueOnce(jsonResponse(200, { status: "healthy" }));

      const resultPromise = client.checkHealth();

      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await resultPromise;
    });

    it("throws SidecarUnreachableError when both attempts reject at the connect level", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"))
        .mockRejectedValueOnce(new TypeError("fetch failed: ECONNREFUSED"));

      const resultPromise = client.checkHealth().catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const err = await resultPromise;

      expect(err).toBeInstanceOf(SidecarUnreachableError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("timeout handling", () => {
    it("throws SidecarUnreachableError on a client-side abort/timeout WITHOUT retrying", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(abortAwareFetch());

      const resultPromise = client.checkHealth().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(DEFAULT_OP_TIMEOUT_MS);
      const err = await resultPromise;

      expect(err).toBeInstanceOf(SidecarUnreachableError);
      // The defining distinction from a connect-level failure: a timeout
      // must NOT trigger the single-retry path.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("non-2xx response -> SidecarResponseError", () => {
    it("maps a 422 invalid_timeout envelope to SidecarResponseError with matching status/errorType/message", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(422, { error: { type: "invalid_timeout", message: "timeout_ms too large" } }),
      );

      const err = await client.navigate("page-1", "https://example.com/item", 1000).catch((e) => e);

      expect(err).toBeInstanceOf(SidecarResponseError);
      expect(err.status).toBe(422);
      expect(err.errorType).toBe("invalid_timeout");
      expect(err.message).toBe("timeout_ms too large");
      // Non-2xx is never retried.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("maps a 404 not_found envelope to SidecarResponseError with matching status/errorType/message", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(404, { error: { type: "not_found", message: "context not found" } }),
      );

      const err = await client.createPage("missing-ctx").catch((e) => e);

      expect(err).toBeInstanceOf(SidecarResponseError);
      expect(err.status).toBe(404);
      expect(err.errorType).toBe("not_found");
      expect(err.message).toBe("context not found");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to a generic internal_error/status-based message when the error body isn't JSON", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response);

      const err = await client.createContext().catch((e) => e);

      expect(err).toBeInstanceOf(SidecarResponseError);
      expect(err.status).toBe(500);
      expect(err.errorType).toBe("internal_error");
      expect(err.message).toBe("sidecar returned HTTP 500 Internal Server Error");
    });
  });

  describe("fetch rejection (connect-level, both attempts fail) -> SidecarUnreachableError", () => {
    it("createContext throws SidecarUnreachableError after both attempts reject", async () => {
      vi.useFakeTimers();
      fetchMock.mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));

      const resultPromise = client.createContext().catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const err = await resultPromise;

      expect(err).toBeInstanceOf(SidecarUnreachableError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("checkHealth", () => {
    it("resolves normally for status: healthy", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: "healthy" }));
      await expect(client.checkHealth()).resolves.toBeUndefined();
    });

    it("throws SidecarResponseError with errorType unhealthy for a non-healthy status", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { status: "degraded" }));

      const err = await client.checkHealth().catch((e) => e);

      expect(err).toBeInstanceOf(SidecarResponseError);
      expect(err.errorType).toBe("unhealthy");
      expect(err.status).toBe(200);
      expect(err.message).toBe("sidecar reported status degraded");
    });

    it("throws SidecarResponseError with errorType unhealthy when status is missing entirely", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));

      const err = await client.checkHealth().catch((e) => e);

      expect(err).toBeInstanceOf(SidecarResponseError);
      expect(err.errorType).toBe("unhealthy");
      expect(err.message).toBe("sidecar reported status unknown");
    });
  });
});
