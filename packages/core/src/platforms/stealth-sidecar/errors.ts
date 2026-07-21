/**
 * Error types for the stealth-sidecar HTTP client.
 *
 * Distinct from `ScrapeError` (packages/core/src/core/errors.ts) and other
 * selector/parsing failures: these represent failures to talk to the
 * sidecar process itself (connection-level or sidecar-reported HTTP
 * errors), not failures to parse a scraped page. Call sites can branch on
 * the whole family with `err instanceof SidecarError`.
 */

/** High-level discriminator for the two SidecarError subclasses. */
export type SidecarErrorKind = "unreachable" | "response";

/**
 * Error `type` values the sidecar itself reports in its
 * `{ error: { type, message } }` envelope for non-2xx responses.
 */
export type SidecarResponseErrorType =
  | "invalid_option"
  | "invalid_url"
  | "invalid_timeout"
  | "not_found"
  | "capacity_exceeded"
  | "operation_timeout"
  | "internal_error"
  | "unhealthy";

export class SidecarError extends Error {
  constructor(
    message: string,
    readonly type: SidecarErrorKind,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SidecarError";
  }
}

/**
 * Thrown when `fetch()` to the sidecar rejects before any HTTP response is
 * received — connection refused/reset, DNS failure, or an abort/timeout
 * fired before a response arrived. Carries the underlying rejection as
 * `cause` when available.
 */
export class SidecarUnreachableError extends SidecarError {
  constructor(message: string, cause?: unknown) {
    super(message, "unreachable", cause === undefined ? undefined : { cause });
    this.name = "SidecarUnreachableError";
  }
}

/**
 * Thrown when the sidecar responds with a non-2xx status. Carries only the
 * sidecar's own `{ type, message }` error envelope plus the HTTP status —
 * never the raw response body, to avoid leaking more than type/message.
 */
export class SidecarResponseError extends SidecarError {
  constructor(
    readonly status: number,
    readonly errorType: SidecarResponseErrorType,
    message: string,
  ) {
    super(message, "response");
    this.name = "SidecarResponseError";
  }
}
