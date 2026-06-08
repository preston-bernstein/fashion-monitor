import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type Logger as PinoLogger } from "pino";

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(event: string, extra?: LogContext): void;
  info(event: string, extra?: LogContext): void;
  warn(event: string, extra?: LogContext): void;
  error(event: string, extra?: LogContext): void;
  child(bindings?: Record<string, unknown>): Logger;
}

export interface SerializedError {
  type: string;
  message: string;
  stack?: string;
}

const CORRELATION_KEYS = new Set([
  "profileId",
  "runId",
  "requestId",
  "userId",
  "integration",
  "platform",
  "queryId",
]);

const SECRET_KEY_PATTERN =
  /password|token|secret|cookie|csrf|hash|api_?key|authorization|encrypted|payload/i;

const REDACTED = "[REDACTED]";

/** Pino-friendly error object for ctx.err or nested Error values. */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const serialized = pino.stdSerializers.err(err);
    return {
      type: serialized.type,
      message: serialized.message,
      ...(serialized.stack ? { stack: serialized.stack } : {}),
    };
  }
  return { type: "Error", message: String(err) };
}

export function redactSecrets<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item)) as T;
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
    } else if (val !== null && typeof val === "object") {
      out[key] = redactSecrets(val);
    } else {
      out[key] = val;
    }
  }
  return out as T;
}

function normalizeErrorFields(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeErrorFields(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val instanceof Error) {
        out[key === "error" ? "err" : key] = serializeError(val);
      } else if (key === "error" && typeof val === "string") {
        out.err = { type: "Error", message: val };
      } else {
        out[key] = normalizeErrorFields(val);
      }
    }
    return out;
  }
  return value;
}

export function resolveLogLevel(): string {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  const env = process.env.NODE_ENV ?? "";
  if (env === "development") return "debug";
  return "info";
}

function splitContext(extra?: LogContext): {
  correlation: Record<string, unknown>;
  ctx?: Record<string, unknown>;
} {
  if (!extra) return { correlation: {} };
  const normalized = normalizeErrorFields(redactSecrets(extra)) as Record<string, unknown>;
  const correlation: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(normalized)) {
    if (CORRELATION_KEYS.has(key)) correlation[key] = val;
    else ctx[key] = val;
  }
  return { correlation, ctx: Object.keys(ctx).length > 0 ? ctx : undefined };
}

function write(
  pinoChild: PinoLogger,
  scope: string,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  extra?: LogContext,
): void {
  const { correlation, ctx } = splitContext(extra);
  const payload: Record<string, unknown> = { scope, event, ...correlation };
  if (ctx) payload.ctx = ctx;
  pinoChild[level](payload);
}

function wrapPino(pinoChild: PinoLogger, scope: string): Logger {
  return {
    debug: (event, extra) => write(pinoChild, scope, "debug", event, extra),
    info: (event, extra) => write(pinoChild, scope, "info", event, extra),
    warn: (event, extra) => write(pinoChild, scope, "warn", event, extra),
    error: (event, extra) => write(pinoChild, scope, "error", event, extra),
    child: (bindings) =>
      wrapPino(pinoChild.child(redactSecrets(bindings ?? {}) as Record<string, unknown>), scope),
  };
}

/** Consistent error log with serialized ctx.err. */
export function logError(
  logger: Logger,
  event: string,
  err: unknown,
  extra?: LogContext,
): void {
  logger.error(event, { ...extra, err: serializeError(err) });
}

let rootPino: PinoLogger | undefined;

/** Shared root pino instance (Fastify + app code). */
export function getRootPino(): PinoLogger {
  rootPino ??= pino({
    level: resolveLogLevel(),
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return rootPino;
}

export function createLogger(scope: string, bindings?: Record<string, unknown>): Logger {
  const child = getRootPino().child(redactSecrets(bindings ?? {}) as Record<string, unknown>);
  return wrapPino(child, scope);
}

const runContext = new AsyncLocalStorage<number>();

/** Attach runId to structured logs for the duration of fn. */
export function withRunContext<T>(runId: number, fn: () => T): T;
export function withRunContext<T>(runId: number, fn: () => Promise<T>): Promise<T>;
export function withRunContext<T>(runId: number, fn: () => T | Promise<T>): T | Promise<T> {
  return runContext.run(runId, fn);
}

/** Logger scoped to the current pipeline run when inside withRunContext. */
export function runLogger(scope: string, extra?: Record<string, unknown>): Logger {
  const runId = runContext.getStore();
  const bindings = runId !== undefined ? { ...extra, runId } : extra;
  return createLogger(scope, bindings);
}
