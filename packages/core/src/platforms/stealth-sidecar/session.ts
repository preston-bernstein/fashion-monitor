/**
 * Session-management helpers layered on top of the low-level stealth-sidecar
 * HTTP client (./client.ts). Mirrors the shape of the retired
 * packages/core/src/platforms/playwright/browser.ts module's caching —
 * `persistentContexts` map and `closeAllStealthBrowsers()` — but operates on
 * sidecar context/page ids instead of local Playwright objects.
 *
 * Two session patterns, matching how the two scrapers use the sidecar:
 *  - Depop: a fresh, ephemeral context+page per run (`withEphemeralPage`).
 *  - Poshmark: one persistent, profile-keyed context reused across runs
 *    (`getOrCreatePersistentContext`).
 */
import { closeContext, closePage, createContext, createPage, getContent } from "./client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `callback` against a brand-new sidecar context+page, always tearing
 * both down afterward — even if `callback` throws. Used by Depop's per-run
 * ephemeral flow, which has no reason to persist a context across runs.
 */
export async function withEphemeralPage<T>(callback: (pageId: string) => Promise<T>): Promise<T> {
  const { contextId } = await createContext();
  const { pageId } = await createPage(contextId);
  try {
    return await callback(pageId);
  } finally {
    try {
      await closePage(pageId);
    } finally {
      await closeContext(contextId);
    }
  }
}

/**
 * Cache of profilePath -> in-flight-or-resolved contextId promise (NOT the
 * resolved string). Caching the promise itself — and doing so synchronously,
 * before awaiting `createContext()` — is what closes the check-then-act
 * race: two concurrent callers for the same profilePath before the first
 * `createContext()` resolves both see the cache hit and await the same
 * promise, rather than both firing their own `createContext()` call.
 */
const persistentContexts = new Map<string, Promise<string>>();

/** True if `profilePath` contains a literal `..` path-traversal segment. */
function hasPathTraversalSegment(profilePath: string): boolean {
  return profilePath.split(/[/\\]/).some((segment) => segment === "..");
}

/**
 * Returns the sidecar contextId for `profilePath`, creating a persistent
 * (userDataDir-backed) context on first use and reusing it on every
 * subsequent call for the same path. Used by Poshmark's cross-run profile
 * persistence.
 *
 * Concurrency-safe: see the `persistentContexts` doc comment above for why
 * the map holds promises, not resolved ids.
 */
export async function getOrCreatePersistentContext(profilePath: string): Promise<string> {
  const existing = persistentContexts.get(profilePath);
  if (existing) return existing;

  if (hasPathTraversalSegment(profilePath)) {
    throw new Error(
      `getOrCreatePersistentContext: profilePath must not contain ".." path-traversal segments: ${profilePath}`,
    );
  }

  const contextIdPromise = createContext({ userDataDir: profilePath }).then((ctx) => ctx.contextId);
  persistentContexts.set(profilePath, contextIdPromise);
  // If context creation fails (e.g. the sidecar is mid-restart, per the
  // migration plan's Risk area #4), don't leave the rejected promise cached
  // forever — evict it so the next call gets a fresh createContext() attempt
  // against a possibly-now-healthy sidecar, instead of replaying the same
  // rejection for the rest of the process's life. Guarded by an identity
  // check in case a newer promise has already replaced this one by the time
  // this rejection handler runs.
  contextIdPromise.catch(() => {
    if (persistentContexts.get(profilePath) === contextIdPromise) {
      persistentContexts.delete(profilePath);
    }
  });
  return contextIdPromise;
}

/**
 * Closes every persistent context currently tracked in `persistentContexts`
 * and clears the map. Mirrors the retired driver's `closeAllStealthBrowsers()`
 * — needed because `apps/cli`'s `forEachProfileSerially` can open multiple
 * profiles' persistent contexts in one process run, and its cleanup call
 * site has no specific `profilePath` on hand, only a "close everything" call.
 */
export async function closeAllPersistentContexts(): Promise<void> {
  for (const [profilePath, contextIdPromise] of persistentContexts) {
    const contextId = await contextIdPromise;
    await closeContext(contextId);
    persistentContexts.delete(profilePath);
  }
}

/**
 * Polls `getContent(pageId)` until `predicate(html)` is true or `timeoutMs`
 * total has elapsed, sleeping `intervalMs` between attempts. Does not throw
 * on timeout — returns whatever HTML the last attempt fetched (which may
 * still fail the predicate), matching the old Depop code's 3x-retry loop
 * that just returned whatever tiles it found on the last attempt, empty
 * array if none. The caller decides what an empty/incomplete result means
 * for its own retry logic.
 */
export async function pollContent(
  pageId: string,
  predicate: (html: string) => boolean,
  opts: { timeoutMs: number; intervalMs: number },
): Promise<string> {
  const deadline = Date.now() + opts.timeoutMs;
  let html = await getContent(pageId);
  while (!predicate(html) && Date.now() < deadline) {
    await sleep(opts.intervalMs);
    html = await getContent(pageId);
  }
  return html;
}
