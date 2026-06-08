import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import csrf from "@fastify/csrf-protection";
import fastifyStatic from "@fastify/static";
import type { Db } from "@fm/core/storage/db.js";
import type { Config } from "@fm/core/core/config.js";
import { loadProfileConfig } from "@fm/core/core/profile-config.js";
import { fetchDashboardPayload } from "@fm/core/analytics/queries.js";
import { createLogger } from "@fm/core/lib/logging.js";
import { LogEvents } from "@fm/core/lib/log-events.js";
import type { Capability } from "@fm/shared/rbac.js";
import { SecretsCipher } from "@fm/core/lib/secrets-crypto.js";
import { ProfileSecretsRepo } from "@fm/core/storage/repos/profile-secrets.js";
import { SessionsRepo } from "@fm/core/storage/repos/sessions.js";
import { UsersRepo, MembershipsRepo } from "@fm/core/storage/repos/users.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";
import { authenticate, type AuthenticatedUser } from "./auth.js";
import { capabilitiesForRole } from "./rbac.js";
import { auditFromRequest, capabilityList, requireCapability, type WebContext } from "./context.js";
import { registerMonitorRoutes } from "./routes/monitors.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSecretsRoutes } from "./routes/secrets.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerAuditRoutes } from "./routes/audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The compiled SPA is copied here by @fm/api#build (apps/web/dist -> dist/public).
const PUBLIC_DIR = join(__dirname, "..", "public");

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
    sessionId?: string;
    capabilities: Set<Capability>;
  }
}

export interface WebAppOptions {
  db: Db;
  profileId?: string;
  /** Bootstrap config (config.yaml) used as fallback for db-backed config + secrets. */
  fileConfig?: Config;
  databasePath?: string;
  /** Cookie signing secret. Generated ephemerally if absent (sessions won't survive restart). */
  sessionSecret?: string;
  /** Key material for encrypting secrets at rest. */
  secretsKey?: string;
  /** Set true when served behind TLS (secure cookies). */
  cookieSecure?: boolean;
  /** Global rate-limit max per minute. */
  rateLimitMax?: number;
  /** Per-minute limit on login attempts. */
  loginRateLimitMax?: number;
  now?: () => Date;
}

// `/api/*` paths reachable without a session (everything else needs auth).
const PUBLIC_API_PATHS = new Set(["/api/health", "/api/csrf", "/api/login", "/api/logout"]);

function isApi(url: string): boolean {
  return url === "/api" || url.startsWith("/api/");
}

function indexHtml(): string {
  const file = join(PUBLIC_DIR, "index.html");
  if (existsSync(file)) return readFileSync(file, "utf8");
  // Fallback when the SPA has not been built (e.g. backend-only test runs).
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Fashion Monitor</title></head><body><div id="root"></div><p>SPA bundle not built. Run <code>npm run build</code>.</p></body></html>`;
}

export async function buildApp(options: WebAppOptions): Promise<FastifyInstance> {
  const log = createLogger("web.app");
  const profileId = options.profileId ?? options.fileConfig?.profile_id ?? "default";
  const now = options.now ?? (() => new Date());
  const sessionSecret =
    options.sessionSecret && options.sessionSecret.length >= 16
      ? options.sessionSecret
      : randomBytes(48).toString("hex");

  const cipher = options.secretsKey ? new SecretsCipher(options.secretsKey) : undefined;

  const ctx: WebContext = {
    db: options.db,
    profileId,
    fileConfig: options.fileConfig,
    databasePath: options.databasePath,
    cipher,
    now,
    secretsRepo: () => (cipher ? new ProfileSecretsRepo(options.db, profileId, cipher) : undefined),
    audit: new AuditLogRepo(options.db, profileId),
    loadConfig: () =>
      loadProfileConfig(options.db, profileId, {
        fallback: options.fileConfig,
        databasePath: options.databasePath ?? options.fileConfig?.database.path,
        secrets: cipher ? new ProfileSecretsRepo(options.db, profileId, cipher) : undefined,
      }),
  };

  const app = Fastify({
    logger: false,
    trustProxy: true,
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return typeof header === "string" && header.length > 0 ? header : randomUUID();
    },
    requestIdLogLabel: "requestId",
  });

  app.addHook("onRequest", async (req) => {
    (req as FastifyRequest & { _startTime?: number })._startTime = Date.now();
  });

  const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode !== 403 || !MUTATING_METHODS.has(req.method)) return payload;
    const text = typeof payload === "string" ? payload : "";
    const isCsrfFailure =
      text.includes("FST_CSRF") ||
      text.toLowerCase().includes("csrf token") ||
      text.toLowerCase().includes("csrf secret");
    if (!isCsrfFailure) return payload;
    auditFromRequest(ctx, req, "auth.csrf.failed");
    createLogger("web.auth", { requestId: req.id }).warn(LogEvents.WebCsrfFailed, {
      method: req.method,
      path: req.url.split("?")[0],
    });
    return payload;
  });

  app.addHook("onResponse", async (req, reply) => {
    const start = (req as FastifyRequest & { _startTime?: number })._startTime;
    const path = req.url.split("?")[0];
    if (!isApi(req.url)) return;
    createLogger("web.request", { requestId: req.id }).info(LogEvents.WebRequestComplete, {
      method: req.method,
      path,
      statusCode: reply.statusCode,
      durationMs: start !== undefined ? Date.now() - start : undefined,
      userId: req.currentUser?.id,
    });
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
  });
  await app.register(cookie, { secret: sessionSecret });
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? 1000,
    timeWindow: "1 minute",
  });
  await app.register(csrf, { cookieOpts: { signed: true, sameSite: "lax", httpOnly: true } });

  const sessions = new SessionsRepo(options.db);
  const users = new UsersRepo(options.db);
  const memberships = new MembershipsRepo(options.db);

  // Resolve the session/user + capabilities, then gate `/api/*` behind login.
  // Non-API requests (the SPA shell + assets) are always served; the client
  // calls `/api/me` and redirects to the login screen itself.
  app.addHook("onRequest", async (req, reply) => {
    req.capabilities = new Set();
    const raw = req.cookies?.sid;
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        const session = sessions.get(unsigned.value, now());
        if (session) {
          const user = users.findById(session.user_id);
          const membership = memberships.forUser(session.user_id, profileId);
          if (user && user.status === "active" && membership) {
            req.currentUser = { id: user.id, email: user.email, role: membership.role };
            req.sessionId = unsigned.value;
            req.capabilities = capabilitiesForRole(membership.role);
          }
        }
      }
    }

    const path = req.url.split("?")[0];
    if (isApi(req.url) && !PUBLIC_API_PATHS.has(path) && !req.currentUser) {
      reply.code(401).send({ error: "unauthorized" });
      return reply;
    }
  });

  // --- Public endpoints (no session required) ---
  app.get("/api/health", async () => ({ ok: true }));

  // Issues a CSRF token (and signed cookie) the SPA echoes back on mutations.
  app.get("/api/csrf", async (_req, reply) => {
    const csrfToken = await reply.generateCsrf();
    return { csrfToken };
  });

  // --- Auth ---
  app.post(
    "/api/login",
    {
      preHandler: app.csrfProtection,
      config: {
        rateLimit: { max: options.loginRateLimitMax ?? 30, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const user = await authenticate(options.db, profileId, email, password);
      const ts = now().toISOString();

      if (!user) {
        ctx.audit.recordFromRequest(
          { userId: null, actorEmail: email || null },
          "login.failed",
          ts,
          { detail: { requestId: req.id } },
        );
        log.warn(LogEvents.WebAuthLoginFailed, { requestId: req.id });
        reply.code(401);
        return { error: "invalid_credentials" };
      }

      const sid = sessions.create(user.id, profileId, now(), SESSION_TTL_SECONDS);
      reply.setCookie("sid", sid, {
        httpOnly: true,
        sameSite: "lax",
        secure: options.cookieSecure ?? false,
        path: "/",
        signed: true,
        maxAge: SESSION_TTL_SECONDS,
      });
      ctx.audit.recordFromRequest(
        { userId: user.id, actorEmail: user.email },
        "login.success",
        ts,
        { detail: { requestId: req.id } },
      );
      log.info(LogEvents.WebAuthLogin, { userId: user.id, requestId: req.id });
      return {
        user: { id: user.id, email: user.email, role: user.role },
        capabilities: capabilityList(capabilitiesForRole(user.role)),
      };
    },
  );

  app.post("/api/logout", { preHandler: app.csrfProtection }, async (req, reply) => {
    if (req.currentUser) {
      auditFromRequest(ctx, req, "logout");
      log.info(LogEvents.WebAuthLogout, { userId: req.currentUser.id, requestId: req.id });
    }
    if (req.sessionId) sessions.destroy(req.sessionId);
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });

  // Current user + resolved capabilities; the SPA's auth gate.
  app.get("/api/me", async (req) => ({
    user: {
      id: req.currentUser!.id,
      email: req.currentUser!.email,
      role: req.currentUser!.role,
    },
    capabilities: capabilityList(req.capabilities),
  }));

  // --- Analytics ---
  app.get(
    "/api/dashboard",
    { preHandler: requireCapability(ctx, "analytics:read") },
    async (req, reply) => {
      const config = ctx.loadConfig();
      reply.header("Cache-Control", "no-store");
      const payload = fetchDashboardPayload(options.db, profileId, config);
      // Integration health is ops-only; curators/viewers must not receive it.
      if (!req.capabilities.has("secrets:read")) {
        return { ...payload, integrationUptime: [], integrationFailures: [] };
      }
      return payload;
    },
  );

  await registerMonitorRoutes(app, ctx);
  await registerSettingsRoutes(app, ctx);
  await registerSecretsRoutes(app, ctx);
  await registerUserRoutes(app, ctx);
  await registerAuditRoutes(app, ctx);

  // --- Static SPA assets + client-side routing fallback ---
  // The SPA shell. Explicit so the bare "/" doesn't hit the static directory
  // handler (which 403s without an index). `no-store` so new deploys land
  // immediately; hashed assets below are cached aggressively.
  const serveShell = (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store").type("text/html").send(indexHtml());
  };
  app.get("/", serveShell);

  // Hashed Vite assets get long-lived caching; index.html is served by the
  // not-found handler with `no-store` so new deploys are picked up immediately.
  if (existsSync(PUBLIC_DIR)) {
    await app.register(fastifyStatic, {
      root: PUBLIC_DIR,
      index: false,
      cacheControl: true,
      maxAge: "1h",
    });
  }

  // Any non-API GET that isn't a real asset serves the SPA shell so the client
  // router can take over. API misses stay JSON 404s.
  app.setErrorHandler((error, req, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    const message = error instanceof Error ? error.message : "unknown error";
    reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_error" : "request_error",
      message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !isApi(req.url)) {
      reply.header("Cache-Control", "no-store").type("text/html").send(indexHtml());
      return;
    }
    reply.code(404).send({ error: "not_found" });
  });

  return app;
}
