import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/platforms/stealth-sidecar/client.js", () => ({
  createContext: vi.fn(),
  createPage: vi.fn(),
  closeContext: vi.fn(),
  closePage: vi.fn(),
  getContent: vi.fn(),
}));

import { closeContext, closePage, createContext, createPage, getContent } from "../../../src/platforms/stealth-sidecar/client.js";
import {
  closeAllPersistentContexts,
  getOrCreatePersistentContext,
  pollContent,
  withEphemeralPage,
} from "../../../src/platforms/stealth-sidecar/session.js";

beforeEach(async () => {
  // Drain any context a previous test left in session.ts's module-level cache
  // BEFORE resetting the mocks — otherwise this drain's own closeContext call
  // would count against the next test's fresh mock-call assertions.
  vi.mocked(closeContext).mockResolvedValue(undefined);
  await closeAllPersistentContexts();

  vi.mocked(createContext).mockReset();
  vi.mocked(createPage).mockReset();
  vi.mocked(closeContext).mockReset().mockResolvedValue(undefined);
  vi.mocked(closePage).mockReset().mockResolvedValue(undefined);
  vi.mocked(getContent).mockReset();
});

describe("withEphemeralPage", () => {
  it("creates a context+page, runs the callback, and closes both on success", async () => {
    vi.mocked(createContext).mockResolvedValue({ contextId: "ctx-1" });
    vi.mocked(createPage).mockResolvedValue({ pageId: "page-1" });

    const result = await withEphemeralPage(async (pageId) => {
      expect(pageId).toBe("page-1");
      return "callback-result";
    });

    expect(result).toBe("callback-result");
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(createPage).toHaveBeenCalledWith("ctx-1");
    expect(closePage).toHaveBeenCalledWith("page-1");
    expect(closeContext).toHaveBeenCalledWith("ctx-1");
  });

  it("still closes the page and context when the callback throws", async () => {
    vi.mocked(createContext).mockResolvedValue({ contextId: "ctx-2" });
    vi.mocked(createPage).mockResolvedValue({ pageId: "page-2" });

    await expect(
      withEphemeralPage(async () => {
        throw new Error("scrape failed");
      }),
    ).rejects.toThrow("scrape failed");

    expect(closePage).toHaveBeenCalledWith("page-2");
    expect(closeContext).toHaveBeenCalledWith("ctx-2");
  });

  it("closes the context even if closing the page itself throws", async () => {
    vi.mocked(createContext).mockResolvedValue({ contextId: "ctx-3" });
    vi.mocked(createPage).mockResolvedValue({ pageId: "page-3" });
    vi.mocked(closePage).mockRejectedValue(new Error("close page failed"));

    await expect(withEphemeralPage(async () => "ok")).rejects.toThrow("close page failed");

    expect(closeContext).toHaveBeenCalledWith("ctx-3");
  });
});

describe("getOrCreatePersistentContext", () => {
  it("creates a context on first call for a profile path", async () => {
    vi.mocked(createContext).mockResolvedValue({ contextId: "ctx-poshmark" });

    const contextId = await getOrCreatePersistentContext("/tmp/profile-a");

    expect(contextId).toBe("ctx-poshmark");
    expect(createContext).toHaveBeenCalledWith({ userDataDir: "/tmp/profile-a" });
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached context on a second call for the same profile path", async () => {
    vi.mocked(createContext).mockResolvedValue({ contextId: "ctx-poshmark" });

    const first = await getOrCreatePersistentContext("/tmp/profile-b");
    const second = await getOrCreatePersistentContext("/tmp/profile-b");

    expect(first).toBe("ctx-poshmark");
    expect(second).toBe("ctx-poshmark");
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("creates a separate context per distinct profile path", async () => {
    vi.mocked(createContext)
      .mockResolvedValueOnce({ contextId: "ctx-1" })
      .mockResolvedValueOnce({ contextId: "ctx-2" });

    const a = await getOrCreatePersistentContext("/tmp/profile-c");
    const b = await getOrCreatePersistentContext("/tmp/profile-d");

    expect(a).toBe("ctx-1");
    expect(b).toBe("ctx-2");
    expect(createContext).toHaveBeenCalledTimes(2);
  });

  it("dedupes two concurrent calls for the same profile path into a single createContext call", async () => {
    let resolveCreate!: (value: { contextId: string }) => void;
    vi.mocked(createContext).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const call1 = getOrCreatePersistentContext("/tmp/profile-race");
    const call2 = getOrCreatePersistentContext("/tmp/profile-race");

    // Both calls fired before createContext's single in-flight promise
    // resolved — this is exactly the check-then-act race the in-flight
    // promise cache (not just the resolved id) is designed to close.
    resolveCreate({ contextId: "ctx-race" });

    const [result1, result2] = await Promise.all([call1, call2]);

    expect(result1).toBe("ctx-race");
    expect(result2).toBe("ctx-race");
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed createContext attempt so the next call retries instead of replaying the same rejection forever", async () => {
    vi.mocked(createContext)
      .mockRejectedValueOnce(new Error("sidecar mid-restart"))
      .mockResolvedValueOnce({ contextId: "ctx-recovered" });

    await expect(getOrCreatePersistentContext("/tmp/profile-flaky")).rejects.toThrow(
      "sidecar mid-restart",
    );

    // Without eviction, this second call would replay the same cached
    // rejection forever instead of trying createContext again.
    const recovered = await getOrCreatePersistentContext("/tmp/profile-flaky");

    expect(recovered).toBe("ctx-recovered");
    expect(createContext).toHaveBeenCalledTimes(2);
  });

  it("rejects a profilePath containing a path-traversal segment without calling createContext", async () => {
    await expect(getOrCreatePersistentContext("/tmp/../etc/passwd")).rejects.toThrow(/path-traversal/);
    expect(createContext).not.toHaveBeenCalled();
  });
});

describe("closeAllPersistentContexts", () => {
  it("closes every tracked context and clears the cache", async () => {
    vi.mocked(createContext)
      .mockResolvedValueOnce({ contextId: "ctx-1" })
      .mockResolvedValueOnce({ contextId: "ctx-2" });

    await getOrCreatePersistentContext("/tmp/profile-e");
    await getOrCreatePersistentContext("/tmp/profile-f");

    await closeAllPersistentContexts();

    expect(closeContext).toHaveBeenCalledWith("ctx-1");
    expect(closeContext).toHaveBeenCalledWith("ctx-2");
    expect(closeContext).toHaveBeenCalledTimes(2);

    // Cache was cleared — the next call for the same path creates a new context.
    vi.mocked(createContext).mockResolvedValueOnce({ contextId: "ctx-3" });
    const reopened = await getOrCreatePersistentContext("/tmp/profile-e");
    expect(reopened).toBe("ctx-3");
  });

  it("is a no-op when nothing is tracked", async () => {
    await expect(closeAllPersistentContexts()).resolves.toBeUndefined();
    expect(closeContext).not.toHaveBeenCalled();
  });
});

describe("pollContent", () => {
  it("returns as soon as the predicate is satisfied, without waiting out the full timeout", async () => {
    vi.mocked(getContent)
      .mockResolvedValueOnce("<div>no tiles yet</div>")
      .mockResolvedValueOnce("<div>tile found</div>");

    const html = await pollContent("page-1", (h) => h.includes("tile found"), {
      timeoutMs: 5_000,
      intervalMs: 5,
    });

    expect(html).toBe("<div>tile found</div>");
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  it("returns the last-fetched HTML without throwing once the timeout elapses", async () => {
    vi.mocked(getContent).mockResolvedValue("<div>still empty</div>");

    const html = await pollContent("page-1", () => false, {
      timeoutMs: 20,
      intervalMs: 5,
    });

    expect(html).toBe("<div>still empty</div>");
  });

  it("returns immediately on the first fetch if the predicate is already satisfied", async () => {
    vi.mocked(getContent).mockResolvedValue("<div>tile found</div>");

    const html = await pollContent("page-1", (h) => h.includes("tile found"), {
      timeoutMs: 5_000,
      intervalMs: 1_000,
    });

    expect(html).toBe("<div>tile found</div>");
    expect(getContent).toHaveBeenCalledTimes(1);
  });
});
