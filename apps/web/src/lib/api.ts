/**
 * Typed fetch client for the Fashion Monitor JSON API.
 *
 * - Always sends the session cookie (`credentials: "include"`).
 * - Fetches and caches a CSRF token, echoed back via the `x-csrf-token`
 *   header on every mutating request (the server validates it against a
 *   signed cookie).
 * - Normalizes non-2xx responses into `ApiError` so callers (and TanStack
 *   Query) get a consistent shape, including the 401 the auth gate uses.
 */

export interface ApiIssue {
  path: (string | number)[];
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: ApiIssue[];

  constructor(status: number, code: string, message: string, issues?: ApiIssue[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

let csrfToken: string | null = null;

async function fetchCsrfToken(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch("/api/csrf", { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, "csrf_failed", "Could not obtain a CSRF token");
  const data = (await res.json()) as { csrfToken: string };
  csrfToken = data.csrfToken;
  return csrfToken;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Internal: prevents infinite CSRF-refresh recursion. */
  _retried?: boolean;
}

function firstIssueMessage(issues: ApiIssue[] | undefined, fallback: string): string {
  return issues && issues.length > 0 ? issues[0].message : fallback;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { accept: "application/json" };

  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (MUTATING.has(method)) headers["x-csrf-token"] = await fetchCsrfToken();

  const res = await fetch(path, {
    method,
    credentials: "include",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = undefined;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: "bad_response", message: text };
    }
  }

  if (res.ok) return payload as T;

  const data = (payload ?? {}) as {
    error?: string;
    message?: string;
    issues?: ApiIssue[];
  };

  // A 403 on a mutation can mean a stale CSRF token (e.g. server restart);
  // refresh once and retry transparently.
  if (res.status === 403 && MUTATING.has(method) && !options._retried) {
    await fetchCsrfToken(true);
    return api<T>(path, { ...options, _retried: true });
  }

  const code = data.error ?? `http_${res.status}`;
  const message = data.message ?? firstIssueMessage(data.issues, code);
  throw new ApiError(res.status, code, message, data.issues);
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const apiPatch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "PATCH", body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });
