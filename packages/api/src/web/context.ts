import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "@fm/core/storage/db.js";
import type { Config } from "@fm/core/core/config.js";
import type { Capability } from "@fm/shared/rbac.js";
import type { SecretsCipher } from "@fm/core/lib/secrets-crypto.js";
import type { ProfileSecretsRepo } from "@fm/core/storage/repos/profile-secrets.js";
import { AuditLogRepo } from "@fm/core/storage/repos/audit-log.js";

/**
 * Per-server (not per-request) dependencies. There is no fixed profileId here
 * on purpose: one server instance serves every profile in the DB, and each
 * request's profile comes from `req.profileId`, resolved from the session
 * (see app.ts's onRequest hook). `loadConfig`/`secretsRepo` take the
 * request's profileId explicitly rather than closing over one.
 */
export interface WebContext {
  db: Db;
  fileConfig?: Config;
  databasePath?: string;
  cipher?: SecretsCipher;
  now: () => Date;
  loadConfig: (profileId: string) => Config;
  secretsRepo: (profileId: string) => ProfileSecretsRepo | undefined;
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Fallback attribution for security-relevant events with no session yet
 * (e.g. a CSRF failure on the unauthenticated /api/login POST). "default" is
 * the bootstrap profile every deployment seeds — not a claim about which
 * profile was targeted, just somewhere real to put a row that would
 * otherwise vanish.
 */
const SYSTEM_PROFILE_ID = "default";

/** Serialize the resolved capability set for the SPA. */
export function capabilityList(caps: Set<Capability>): Capability[] {
  return [...caps];
}

/**
 * Records an audit entry scoped to the REQUEST's profile (req.profileId),
 * falling back to SYSTEM_PROFILE_ID when no session/profile is resolved yet.
 */
export function auditFromRequest(
  ctx: WebContext,
  req: FastifyRequest,
  action: string,
  options?: { target?: string | null; detail?: Record<string, unknown> },
): void {
  const path = req.url.split("?")[0];
  new AuditLogRepo(ctx.db, req.profileId ?? SYSTEM_PROFILE_ID).recordFromRequest(
    {
      userId: req.currentUser?.id ?? null,
      actorEmail: req.currentUser?.email ?? null,
    },
    action,
    ctx.now().toISOString(),
    {
      target: options?.target ?? path,
      detail: {
        ...options?.detail,
        path,
        method: req.method,
        requestId: req.id,
      },
    },
  );
}

/**
 * Capability guard for `/api/*` routes. The server is the source of truth;
 * the SPA only uses `/api/me` to hide controls it cannot use.
 */
export function requireCapability(ctx: WebContext, cap: Capability) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.capabilities.has(cap)) {
      if (MUTATING_METHODS.has(req.method)) {
        auditFromRequest(ctx, req, "auth.forbidden", {
          detail: { capability: cap },
        });
      }
      reply.code(403).send({ error: "forbidden", capability: cap });
      return reply;
    }
  };
}
