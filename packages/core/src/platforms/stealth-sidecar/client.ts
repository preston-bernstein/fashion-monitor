/**
 * Low-level HTTP wrapper around the stealth-sidecar (scraper-commons)
 * browser-automation service. Each exported function is a thin mapping onto
 * one sidecar route — no scraper-specific logic lives here, and callers
 * (Depop/Poshmark scrapers etc.) own their own logging: per the migration
 * plan's Security notes, raw HTML and full URLs with query params must
 * never be logged, but that's a caller concern — this module does no
 * logging at all.
 *
 * Base URL resolution: `STEALTH_SIDECAR_URL` env var, defaulting to
 * `http://127.0.0.1:8000` (the sidecar's local default).
 */
import { fetchWithTimeout } from "../../lib/http.js";
import {
  SidecarResponseError,
  SidecarUnreachableError,
  type SidecarResponseErrorType,
} from "./errors.js";

/** Default sidecar base URL when STEALTH_SIDECAR_URL is unset. */
const DEFAULT_SIDECAR_URL = "http://127.0.0.1:8000";

/**
 * The sidecar's own configured operation timeout default (`op_timeout_ms`),
 * per docs/stealth-sidecar-migration/plan.md. Used as the client-side fetch
 * timeout for calls that don't send their own `timeout_ms` (health checks,
 * context/page create, content/screenshot reads, deletes).
 */
const DEFAULT_OP_TIMEOUT_MS = 30_000;

/**
 * Safe ceiling for a caller-requested `navigate` timeout. Must stay below
 * the sidecar's configured `op_timeout_ms` (default 30_000ms) — sending
 * `timeout_ms` at or above that gets a 422 `invalid_timeout`. We cap well
 * below the default (rather than matching it exactly) since a deployment
 * could configure a lower `op_timeout_ms` than the default.
 */
const MAX_NAVIGATE_TIMEOUT_MS = 25_000;

/**
 * Headroom added on top of whatever `timeout_ms` we send the sidecar for
 * `navigate`, so the sidecar's own operation_timeout response has a chance
 * to arrive before our client-side AbortController fires first.
 */
const TIMEOUT_HEADROOM_MS = 5_000;

/** Fixed delay before the single retry on a connect-level failure. */
const RETRY_DELAY_MS = 200;

/** Resolve the sidecar base URL from the environment (read fresh each call). */
export function getSidecarBaseUrl(): string {
  return process.env.STEALTH_SIDECAR_URL || DEFAULT_SIDECAR_URL;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with exactly one retry, fired only when the failure is
 * connect-level — `fetch()` rejected before any response arrived (e.g.
 * ECONNREFUSED / ECONNRESET / ENOTFOUND) — after a fixed 200ms delay.
 * Never retries a timeout we triggered ourselves (an AbortError from our
 * own AbortController) or a non-2xx response: both of those mean the
 * request may have already partially executed against the sidecar's single
 * in-flight worker slot, and retrying blindly could double-navigate or
 * leak a context.
 */
async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetchWithTimeout(url, { ...init, timeoutMs });
  } catch (err) {
    if (isAbortError(err)) {
      throw new SidecarUnreachableError(
        `sidecar request timed out after ${timeoutMs}ms: ${url}`,
        err,
      );
    }
    await sleep(RETRY_DELAY_MS);
    try {
      return await fetchWithTimeout(url, { ...init, timeoutMs });
    } catch (retryErr) {
      if (isAbortError(retryErr)) {
        throw new SidecarUnreachableError(
          `sidecar request timed out after ${timeoutMs}ms on retry: ${url}`,
          retryErr,
        );
      }
      throw new SidecarUnreachableError(`sidecar unreachable: ${url}`, retryErr);
    }
  }
}

/** Parse the sidecar's `{ error: { type, message } }` envelope off a non-2xx response. */
async function parseErrorEnvelope(response: Response): Promise<SidecarResponseError> {
  let type: SidecarResponseErrorType = "internal_error";
  let message = `sidecar returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  try {
    const body = (await response.json()) as { error?: { type?: string; message?: string } };
    if (body?.error?.type) type = body.error.type as SidecarResponseErrorType;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // Non-JSON or empty error body — fall back to the generic status-based message.
  }
  return new SidecarResponseError(response.status, type, message);
}

/**
 * Issue a sidecar request, retrying per `fetchWithRetry`, and throw
 * `SidecarResponseError` on any non-2xx response. Returns both the raw
 * `Response` (for status-code-sensitive callers like `checkHealth`) and the
 * parsed JSON body.
 */
async function sidecarRequest<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; body: T }> {
  const url = `${getSidecarBaseUrl()}${path}`;
  const response = await fetchWithRetry(url, init, timeoutMs);
  if (!response.ok) {
    throw await parseErrorEnvelope(response);
  }
  const body = (await response.json()) as T;
  return { response, body };
}

/**
 * Best-effort cleanup delete: treats 404 (already gone) as success rather
 * than throwing. Any other non-2xx status still throws, so a caller that
 * cares can observe a genuinely failed cleanup.
 */
async function bestEffortDelete(path: string): Promise<void> {
  const url = `${getSidecarBaseUrl()}${path}`;
  const response = await fetchWithRetry(url, { method: "DELETE" }, DEFAULT_OP_TIMEOUT_MS);
  if (response.ok || response.status === 404) return;
  throw await parseErrorEnvelope(response);
}

export interface CreateContextOptions {
  userDataDir?: string;
}

export interface SidecarContext {
  contextId: string;
}

/**
 * `POST /v1/contexts` with a FLAT JSON body (`{ user_data_dir? }`) — NOT
 * wrapped in an `"options"` key. The sidecar's actual route handler and its
 * own schemas.py disagree on this; this flat shape was verified against the
 * route handler during migration planning and is the one to trust.
 */
export async function createContext(opts: CreateContextOptions = {}): Promise<SidecarContext> {
  const body: { user_data_dir?: string } = {};
  if (opts.userDataDir !== undefined) body.user_data_dir = opts.userDataDir;

  const { body: responseBody } = await sidecarRequest<{ context_id: string }>(
    "/v1/contexts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    DEFAULT_OP_TIMEOUT_MS,
  );
  return { contextId: responseBody.context_id };
}

export interface SidecarPage {
  pageId: string;
}

/** `POST /v1/contexts/{contextId}/pages` — 404 surfaces as `SidecarResponseError` errorType `"not_found"`. */
export async function createPage(contextId: string): Promise<SidecarPage> {
  const { body } = await sidecarRequest<{ page_id: string }>(
    `/v1/contexts/${encodeURIComponent(contextId)}/pages`,
    { method: "POST" },
    DEFAULT_OP_TIMEOUT_MS,
  );
  return { pageId: body.page_id };
}

/**
 * `POST /v1/pages/{pageId}/navigate` with JSON body `{ url, timeout_ms? }`.
 *
 * `timeoutMs`, if passed, is capped at `MAX_NAVIGATE_TIMEOUT_MS` (25s) —
 * safely below the sidecar's default `op_timeout_ms` (30s) — rather than
 * forwarded as-is, since the sidecar 422s with `invalid_timeout` when
 * `timeout_ms` meets or exceeds its configured limit. Omitting `timeoutMs`
 * entirely omits `timeout_ms` from the request body, letting the sidecar
 * use its own default.
 */
export async function navigate(pageId: string, url: string, timeoutMs?: number): Promise<void> {
  const cappedTimeoutMs =
    timeoutMs === undefined ? undefined : Math.min(timeoutMs, MAX_NAVIGATE_TIMEOUT_MS);

  const requestBody: { url: string; timeout_ms?: number } = { url };
  if (cappedTimeoutMs !== undefined) requestBody.timeout_ms = cappedTimeoutMs;

  const clientTimeoutMs = (cappedTimeoutMs ?? DEFAULT_OP_TIMEOUT_MS) + TIMEOUT_HEADROOM_MS;

  await sidecarRequest<unknown>(
    `/v1/pages/${encodeURIComponent(pageId)}/navigate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
    clientTimeoutMs,
  );
}

/**
 * `GET /v1/pages/{pageId}/content` — returns the page's raw HTML.
 *
 * ASSUMPTION: the response envelope is `{ content: string }`. This wasn't
 * verified against the live sidecar source (only against the migration
 * plan's table, which itself flags this endpoint's exact shape as
 * unconfirmed) — a later integration-validation pass against the running
 * sidecar should catch it if the real field name differs.
 */
export async function getContent(pageId: string): Promise<string> {
  const { body } = await sidecarRequest<{ content: string }>(
    `/v1/pages/${encodeURIComponent(pageId)}/content`,
    { method: "GET" },
    DEFAULT_OP_TIMEOUT_MS,
  );
  return body.content;
}

/**
 * `GET /v1/pages/{pageId}/screenshot` — returns a base64-encoded PNG,
 * converted here to a Node `Buffer` for callers.
 *
 * ASSUMPTION: like `getContent`, the response envelope is assumed to be
 * `{ screenshot: string }` (base64 PNG) — not verified against the live
 * sidecar source. Flagged for the same later integration-validation pass.
 */
export async function getScreenshot(pageId: string): Promise<Buffer> {
  const { body } = await sidecarRequest<{ screenshot: string }>(
    `/v1/pages/${encodeURIComponent(pageId)}/screenshot`,
    { method: "GET" },
    DEFAULT_OP_TIMEOUT_MS,
  );
  return Buffer.from(body.screenshot, "base64");
}

/**
 * `GET /v1/health`. Throws `SidecarUnreachableError` if the fetch itself
 * fails, or `SidecarResponseError` with errorType `"unhealthy"` when the
 * response body's `status` field isn't `"healthy"` (a 200 response can
 * still report an unhealthy sidecar in its body).
 */
export async function checkHealth(): Promise<void> {
  const { response, body } = await sidecarRequest<{ status?: string }>(
    "/v1/health",
    { method: "GET" },
    DEFAULT_OP_TIMEOUT_MS,
  );
  if (body.status !== "healthy") {
    throw new SidecarResponseError(
      response.status,
      "unhealthy",
      `sidecar reported status ${body.status ?? "unknown"}`,
    );
  }
}

/** `DELETE /v1/pages/{pageId}` — best-effort; 404 (already gone) is not an error. */
export async function closePage(pageId: string): Promise<void> {
  await bestEffortDelete(`/v1/pages/${encodeURIComponent(pageId)}`);
}

/** `DELETE /v1/contexts/{contextId}` — best-effort; 404 (already gone) is not an error. */
export async function closeContext(contextId: string): Promise<void> {
  await bestEffortDelete(`/v1/contexts/${encodeURIComponent(contextId)}`);
}
